import { NextResponse } from "next/server"
import { BUILDER_SHEET_TABS } from "@/lib/sheet-validator"

/**
 * GET /api/upcoming
 *
 * Reads Table 4 from each builder's Google Sheet and returns upcoming
 * community floorplan data. Table 4 column layout:
 *
 *   col 0: Community        col 7: Baths
 *   col 1: City             col 8: Ready By / Est. Opening
 *   col 2: Floorplan name   col 9: HOA fees
 *   col 3: Property type   col 10: Taxes
 *   col 4: Floors          col 11: Elementary school
 *   col 5: Sqft            col 12: Middle school
 *   col 6: Beds            col 13: High school
 *
 * Upcoming communities are intentionally NOT in the DB — read directly from sheet.
 */

const SHEET_ID       = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const CACHE_TTL_MS   = 10 * 60 * 1000   // 10 minutes (upcoming data changes infrequently)
const FETCH_TIMEOUT  = 8_000             // per-builder fetch timeout

interface UpcomingPlan {
  builder:   string
  community: string
  city:      string | null
  floorplan: string
  type:      string | null
  floors:    number | null
  sqft:      number | null
  beds:      number | null
  baths:     number | null
  readyBy:   string | null
  hoaFees:   number | null
  taxes:     string | null
  schools:   string[]
}

// Stale-aware cache: keeps previous data so a failed re-fetch doesn't wipe the page
interface Cache {
  data:      UpcomingPlan[]
  expiresAt: number
}
let _cache: Cache | null = null

/**
 * Parse a numeric cell. `parseFloat` already ignores trailing non-numeric chars
 * ("2.5 ba" → 2.5, "1,450 sf" → 1450 after stripping commas).
 */
function parseNum(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(v.replace(/[,$]/g, "").trim())
  return isNaN(n) ? null : n
}

/**
 * Minimal CSV parser. Strips \r before splitting so Windows-style \r\n
 * line endings don't corrupt cell values or header comparisons.
 */
function parseCSV(text: string): string[][] {
  return text.replace(/\r/g, "").split("\n").map((line) => {
    const cells: string[] = []
    let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ)  { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

async function fetchTable4(builderName: string, tabName: string): Promise<UpcomingPlan[]> {
  const url   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  const plans: UpcomingPlan[] = []

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal:   AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return plans

    const rows     = parseCSV(await res.text())
    let inTable4   = false

    for (const row of rows) {
      const col0 = row[0]?.trim() ?? ""

      // Start of Table 4
      if (col0 === "Table 4") { inTable4 = true; continue }

      // Stop on any other Table N header (Table 5, Table 6, Notes, etc.)
      if (inTable4 && /^Table\s*\d+$/i.test(col0) && col0 !== "Table 4") break

      if (!inTable4)   continue
      if (!col0)        continue  // blank row
      if (col0 === "Community") continue  // column header row

      const floorplan = row[2]?.trim() ?? ""
      if (!floorplan)  continue

      const schools = [row[11]?.trim(), row[12]?.trim(), row[13]?.trim()]
        .filter(Boolean) as string[]

      plans.push({
        builder:   builderName,
        community: col0,
        city:      row[1]?.trim()  || null,
        floorplan,
        type:      row[3]?.trim()  || null,
        floors:    parseNum(row[4]),
        sqft:      parseNum(row[5]),
        beds:      parseNum(row[6]),
        baths:     parseNum(row[7]),
        readyBy:   row[8]?.trim()  || null,
        hoaFees:   parseNum(row[9]),
        taxes:     row[10]?.trim() || null,
        schools,
      })
    }
  } catch (err) {
    console.warn(`[upcoming] fetchTable4 error for "${tabName}":`, err)
  }

  return plans
}

async function getAllUpcoming(): Promise<UpcomingPlan[]> {
  // Return fresh cache if still valid
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data

  const results = await Promise.all(
    Object.entries(BUILDER_SHEET_TABS).map(([builder, tab]) =>
      fetchTable4(builder, tab)
    )
  )

  const data = results.flat()

  // Only cache if we got results — an empty response likely means a fetch
  // failure, not genuinely no upcoming communities. Keep stale data instead.
  if (data.length > 0) {
    _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  } else if (_cache) {
    // Stale fallback: extend TTL so next request tries again in 2 minutes
    console.warn("[upcoming] All builder fetches returned empty — serving stale cache")
    _cache = { ..._cache, expiresAt: Date.now() + 2 * 60 * 1000 }
  }
  // If data is empty AND no prior cache exists, return [] (genuinely no data)

  return data.length > 0 ? data : (_cache?.data ?? [])
}

export async function GET() {
  try {
    const plans = await getAllUpcoming()
    return NextResponse.json(
      { ok: true, count: plans.length, plans },
      {
        headers: {
          // Upcoming data changes at most weekly — long cache is safe.
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[upcoming] Unhandled error:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
