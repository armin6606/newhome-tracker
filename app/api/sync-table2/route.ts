import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { BUILDER_SHEET_TABS } from "@/lib/sheet-validator"
import { timingSafeEqual, createHash } from "crypto"

/**
 * POST /api/sync-table2
 *
 * Force-syncs DB placeholder lots from Google Sheet Table 2 counts.
 * Call this any time you manually update Table 2 and want community
 * cards to reflect the new counts immediately (without waiting for 1 AM).
 *
 * Auth: x-ingest-secret header (same secret as /api/ingest)
 *
 * Body (optional): { builder: "Toll Brothers" }
 *   → syncs only that builder's communities (faster)
 *   → omit to sync all builders
 */

export const maxDuration = 300  // Vercel Pro max — full sync needs it

const SHEET_ID     = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const FETCH_TIMEOUT = 8_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** Minimal CSV parser — strips \r so Windows-style CRLF doesn't break comparisons */
function parseCSV(text: string): string[][] {
  return text.replace(/\r/g, "").split("\n").map((line) => {
    const cells: string[] = []
    let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

interface Table2Row {
  sold:    number
  forSale: number
  future:  number
  total:   number
}

async function fetchTable2(tabName: string): Promise<{
  counts:   Record<string, Table2Row>
  fetchErr: string | null
}> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal:   AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) {
      return { counts: {}, fetchErr: `Google Sheet returned HTTP ${res.status} for tab "${tabName}"` }
    }

    const rows:   string[][]                           = parseCSV(await res.text())
    const counts: Record<string, Table2Row>            = {}

    for (const row of rows) {
      if (row[0]?.trim() === "Table 3") break
      const name = row[3]?.trim()
      if (!name || name === "Table 2 Community" || name === "Table 2" || name === "Community") continue

      const sold    = parseInt(row[4], 10) || 0
      const forSale = parseInt(row[5], 10) || 0
      const future  = parseInt(row[6], 10) || 0
      const total   = parseInt(row[7], 10) || 0

      if (sold + forSale + future + total === 0) continue

      // Cross-validate the total column
      if (total > 0 && sold + forSale + future !== total) {
        console.warn(
          `[sync-table2] "${name}" in tab "${tabName}": ` +
          `sold(${sold}) + forSale(${forSale}) + future(${future}) = ${sold + forSale + future} ` +
          `≠ total(${total}) — sheet formula may be wrong`
        )
      }

      counts[name] = { sold, forSale, future, total }
    }

    return { counts, fetchErr: null }
  } catch (err) {
    return { counts: {}, fetchErr: `Fetch failed for tab "${tabName}": ${String(err)}` }
  }
}

async function syncPlaceholders(
  communityId: number,
  counts: { sold: number; forSale: number; future: number },
): Promise<{ added: number; removed: number }> {
  const existing = await prisma.listing.findMany({
    where:  { communityId, address: null },
    select: { id: true, status: true, lotNumber: true },
  })

  const activeSold   = existing.filter((l) => l.status === "sold")
  const activeAvail  = existing.filter((l) => l.status === "active")
  const activeFuture = existing.filter((l) => l.status === "future")

  const toCreate:     { communityId: number; lotNumber: string; status: string; address: null }[] = []
  const toReactivate: { id: number; status: string }[] = []
  const toDelete:     number[] = []

  function reconcile(
    active:    { id: number; status: string; lotNumber: string | null }[],
    prefix:    string,
    needCount: number,
    newStatus: string,
  ) {
    const numOf = (l: { lotNumber: string | null }) =>
      parseInt((l.lotNumber ?? "").replace(prefix + "-", ""), 10) || 0

    if (needCount > active.length) {
      const deficit       = needCount - active.length
      const removedOfType = existing
        .filter((l) => l.status === "removed" && l.lotNumber?.startsWith(prefix + "-"))
        .sort((a, b) => numOf(a) - numOf(b))
      const toRevive = removedOfType.slice(0, deficit)
      toReactivate.push(...toRevive.map((l) => ({ id: l.id, status: newStatus })))
      const allOfType = existing.filter((l) => l.lotNumber?.startsWith(prefix + "-"))
      const maxN      = allOfType.reduce((m, l) => Math.max(m, numOf(l)), 0)
      for (let i = toRevive.length; i < deficit; i++)
        toCreate.push({
          communityId,
          lotNumber: `${prefix}-${maxN + (i - toRevive.length) + 1}`,
          status: newStatus,
          address: null,
        })
    } else if (needCount < active.length) {
      toDelete.push(
        ...[...active]
          .sort((a, b) => numOf(b) - numOf(a))
          .slice(0, active.length - needCount)
          .map((l) => l.id)
      )
    }
  }

  reconcile(activeSold,   "sold",   counts.sold,    "sold")
  reconcile(activeAvail,  "avail",  counts.forSale, "active")
  reconcile(activeFuture, "future", counts.future,  "future")

  // Wrap deletes in a transaction — prevents orphaned priceHistory rows if
  // the process crashes between the two deleteMany calls
  if (toDelete.length > 0) {
    await prisma.$transaction([
      prisma.priceHistory.deleteMany({ where: { listingId: { in: toDelete } } }),
      prisma.listing.deleteMany({ where: { id: { in: toDelete } } }),
    ])
  }
  if (toReactivate.length > 0) {
    const byStat = new Map<string, number[]>()
    for (const { id, status } of toReactivate) {
      if (!byStat.has(status)) byStat.set(status, [])
      byStat.get(status)!.push(id)
    }
    await Promise.all(
      [...byStat.entries()].map(([status, ids]) =>
        prisma.listing.updateMany({ where: { id: { in: ids } }, data: { status } })
      )
    )
  }
  if (toCreate.length > 0) {
    await prisma.listing.createMany({ data: toCreate, skipDuplicates: true })
  }

  return { added: toReactivate.length + toCreate.length, removed: toDelete.length }
}

// ── Per-builder sync ──────────────────────────────────────────────────────────

interface BuilderSyncResult {
  summary:  { builder: string; community: string; sold: number; forSale: number; future: number; added: number; removed: number }[]
  errors:   { builder: string; error: string }[]
  notFound: { builder: string; community: string }[]
}

async function syncBuilder(builderName: string): Promise<BuilderSyncResult> {
  const result: BuilderSyncResult = { summary: [], errors: [], notFound: [] }
  const tabName = BUILDER_SHEET_TABS[builderName]

  // Fetch sheet counts
  const { counts, fetchErr } = await fetchTable2(tabName)
  if (fetchErr) {
    result.errors.push({ builder: builderName, error: fetchErr })
    return result
  }
  if (Object.keys(counts).length === 0) {
    result.errors.push({ builder: builderName, error: `No Table 2 data found in tab "${tabName}"` })
    return result
  }

  // Pre-fetch all communities for this builder in ONE query (avoids N findUnique calls)
  const builderRecord = await prisma.builder.findUnique({ where: { name: builderName } })
  if (!builderRecord) return result

  const dbCommunities = await prisma.community.findMany({
    where:  { builderId: builderRecord.id },
    select: { id: true, name: true },
  })
  const communityMap = new Map(dbCommunities.map((c) => [c.name, c]))

  // Sync each community from the sheet
  for (const [communityName, c] of Object.entries(counts)) {
    const community = communityMap.get(communityName)
    if (!community) {
      // Sheet has this community but it's not in the DB yet
      result.notFound.push({ builder: builderName, community: communityName })
      continue
    }

    try {
      const { added, removed } = await syncPlaceholders(community.id, c)
      result.summary.push({
        builder: builderName, community: communityName,
        sold: c.sold, forSale: c.forSale, future: c.future,
        added, removed,
      })
    } catch (err) {
      result.errors.push({ builder: builderName, error: `${communityName}: ${String(err)}` })
    }
  }

  return result
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const provided = req.headers.get("x-ingest-secret") ?? ""
    const expected = process.env.INGEST_SECRET ?? ""
    if (!expected || !secretsEqual(provided, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body: Record<string, unknown> = await req.json().catch(() => ({}))
    const onlyBuilder = typeof body?.builder === "string" ? body.builder : undefined

    const buildersToSync = onlyBuilder
      ? (BUILDER_SHEET_TABS[onlyBuilder] ? [onlyBuilder] : [])
      : Object.keys(BUILDER_SHEET_TABS)

    if (buildersToSync.length === 0) {
      return NextResponse.json({ error: `Unknown builder "${onlyBuilder}"` }, { status: 400 })
    }

    // Run all builders in parallel (safe — each operates on its own sheet tab + DB rows)
    const builderResults = await Promise.all(buildersToSync.map(syncBuilder))

    // Aggregate results
    const summary:  BuilderSyncResult["summary"]  = []
    const errors:   BuilderSyncResult["errors"]   = []
    const notFound: BuilderSyncResult["notFound"] = []

    for (const r of builderResults) {
      summary.push(...r.summary)
      errors.push(...r.errors)
      notFound.push(...r.notFound)
    }

    const changed = summary.filter((s) => s.added > 0 || s.removed > 0)

    return NextResponse.json({
      ok:       true,
      synced:   summary.length,
      changed:  changed.length,
      summary:  changed.length  > 0 ? changed   : undefined,
      errors:   errors.length   > 0 ? errors    : undefined,
      notFound: notFound.length > 0 ? notFound  : undefined,
    })
  } catch (err) {
    console.error("[sync-table2] Unhandled error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
