/**
 * Fetches community override data from the Google Sheet.
 * The sheet columns are: Community Name | Builder | Property Type | HOA ($/mo) | Annual Tax ($) | Tax Rate (%) | Notes
 * Used to override scraped HOA, taxes, and property type values.
 */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo/export?format=csv&gid=0"

// Cache for 5 minutes so repeated requests don't hit Google on every API call
let cache: { data: SheetRow[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export type SheetRow = {
  communityName: string
  builder: string
  propertyType: string | null
  hoa: number | null
  annualTax: number | null
  taxRate: number | null
  notes: string | null
}

function parseLine(line: string): string[] {
  // Sheet exports tab-separated
  return line.split("\t").map((c) => c.trim())
}

export async function fetchSheetData(): Promise<SheetRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data
  }

  try {
    const res = await fetch(SHEET_CSV_URL, { next: { revalidate: 300 } })
    if (!res.ok) return []
    const text = await res.text()

    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) return []

    // Skip header row (row 0)
    const rows: SheetRow[] = []
    for (const line of lines.slice(1)) {
      const cols = parseLine(line)
      const communityName = cols[0] || ""
      if (!communityName) continue

      const hoa = cols[3] ? parseInt(cols[3].replace(/[^0-9]/g, ""), 10) : null
      const annualTax = cols[4] ? parseInt(cols[4].replace(/[^0-9]/g, ""), 10) : null
      const taxRate = cols[5] ? parseFloat(cols[5]) : null

      rows.push({
        communityName,
        builder: cols[1] || "",
        propertyType: cols[2] || null,
        hoa: hoa && !isNaN(hoa) && hoa > 0 ? hoa : null,
        annualTax: annualTax && !isNaN(annualTax) && annualTax > 0 ? annualTax : null,
        taxRate: taxRate && !isNaN(taxRate) ? taxRate : null,
        notes: cols[6] || null,
      })
    }

    cache = { data: rows, fetchedAt: Date.now() }
    return rows
  } catch {
    return cache?.data ?? []
  }
}

/** Returns a lookup map: lowercase community name → sheet row */
export async function getSheetLookup(): Promise<Map<string, SheetRow>> {
  const rows = await fetchSheetData()
  const map = new Map<string, SheetRow>()
  for (const row of rows) {
    map.set(row.communityName.toLowerCase().trim(), row)
  }
  return map
}

/**
 * Resolves the best sheet row for a listing.
 * Priority:
 *  1. Exact community name match  (e.g. "Toll Brothers At Great Park Neighborhoods - Elm Collection")
 *  2. Collection-prefixed match    (e.g. "Rhea Great Park Neighborhoods" when floorPlan = "Rhea 1")
 *  3. undefined if no match found
 */
export function resolveSheetRow(
  lookup: Map<string, SheetRow>,
  communityName: string,
  floorPlan?: string | null
): SheetRow | undefined {
  const communityKey = communityName.toLowerCase().trim()

  // 1. Exact match
  const exact = lookup.get(communityKey)
  if (exact) return exact

  // 2. Collection prefix: first word of floorPlan + community name
  //    e.g. floorPlan="Rhea 1" → "rhea great park neighborhoods"
  if (floorPlan) {
    const collection = floorPlan.split(" ")[0].toLowerCase()
    const collectionKey = `${collection} ${communityKey}`
    const collectionMatch = lookup.get(collectionKey)
    if (collectionMatch) return collectionMatch
  }

  // 3. Keyword subset match: every significant word in the sheet row name
  //    must appear somewhere in the DB community name.
  //    Allows clean sheet names like "Elm Collection Great Park Neighborhoods"
  //    to match DB name "Toll Brothers At Great Park Neighborhoods - Elm Collection"
  const STOP_WORDS = new Set(["at", "by", "in", "the", "and", "of", "for"])
  for (const [sheetKey, row] of lookup) {
    const words = sheetKey.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    if (words.length >= 2 && words.every((w) => communityKey.includes(w))) {
      return row
    }
  }

  return undefined
}
