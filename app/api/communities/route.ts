import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isSheetVerified, BUILDER_SHEET_TABS } from "@/lib/sheet-validator"

export async function GET() {
  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { name: true } },
      listings: {
        select: {
          id: true,
          address: true,
          lotNumber: true,
          status: true,
          currentPrice: true,
          sqft: true,
          firstDetected: true,
          soldAt: true,
        },
      },
    },
    orderBy: { name: "asc" },
  })

  // ── Sheet guardrail: only show communities verified in the Google Sheet ──
  // Check builder tab existence first (fast, no network), then community in Table 2.
  const verified = await Promise.all(
    communities.map(async (c) => ({
      c,
      ok: BUILDER_SHEET_TABS[c.builder.name]
        ? await isSheetVerified(c.builder.name, c.name)
        : false,
    }))
  )
  const allowedCommunities = verified.filter((v) => v.ok).map((v) => v.c)

  const result = allowedCommunities.map((c) => {
    // ── IMMUTABLE RULE: Community card counts MUST come ONLY from Table 2 ──
    // Source chain: Google Sheet Table 2 → DB placeholder lots → this API → cards
    //
    // Placeholder lots have address=null and lotNumber matching (sold|avail|future)-N.
    // The ingest route keeps these in sync with Table 2 in real time (on every
    // scraper event) and the 1 AM sync reconciles any remaining drift.
    //
    // NEVER fall back to real listing counts. NEVER use builder API counts.
    // If placeholders are 0, the card shows 0 — that is correct and signals that
    // the Table 2 sync has not run yet, not a reason to use any other source.
    const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/
    const placeholders   = c.listings.filter((l) => l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber))

    // Runtime guard: warn in server logs if a community has real listings but no placeholders
    const realListings = c.listings.filter((l) => l.address !== null)
    if (realListings.length > 0 && placeholders.length === 0) {
      console.warn(
        `[communities] "${c.name}" (${c.builder.name}) has ${realListings.length} real listing(s) ` +
        `but 0 placeholders. Table 2 sync may be needed.`
      )
    }

    const active  = placeholders.filter((l) => l.status === "active").length
    const sold    = placeholders.filter((l) => l.status === "sold").length
    const future  = placeholders.filter((l) => l.status === "future").length
    const total   = placeholders.filter((l) => l.status !== "removed").length

    // Validation: total must equal sum of parts (catches placeholder corruption)
    if (total !== active + sold + future) {
      console.error(
        `[communities] Placeholder count mismatch for "${c.name}": ` +
        `active=${active} + sold=${sold} + future=${future} ≠ total=${total}. ` +
        `Check for orphaned placeholder lots.`
      )
    }

    const trackingStart  = c.firstDetected ?? new Date()
    const observedSales  = c.listings.filter((l) => l.soldAt !== null && l.soldAt >= trackingStart && l.address !== null)
    let salesPerMonth = 0
    if (observedSales.length > 0) {
      const spanMonths = Math.max(1, (Date.now() - trackingStart.getTime()) / (1000 * 60 * 60 * 24 * 30))
      salesPerMonth    = parseFloat((observedSales.length / spanMonths).toFixed(1))
    }

    const soldWithDates = c.listings.filter((l) => l.soldAt && l.firstDetected)
    const avgDaysOnMarket =
      soldWithDates.length > 0
        ? Math.round(
            soldWithDates.reduce((sum, l) => {
              return sum + (l.soldAt!.getTime() - l.firstDetected.getTime()) / (1000 * 60 * 60 * 24)
            }, 0) / soldWithDates.length
          )
        : null

    const prices   = c.listings.map((l) => l.currentPrice).filter(Boolean) as number[]
    const minPrice = prices.length ? Math.min(...prices) : null
    const maxPrice = prices.length ? Math.max(...prices) : null

    const DAY_MS             = 24 * 60 * 60 * 1000
    const TRACKING_START_MS  = Date.UTC(2026, 2, 27) // March 27, 2026
    const todayUTC           = new Date()
    const todayStart         = Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate())
    const salesByWeek: { week: string; sold: number }[] = []
    for (let dStart = TRACKING_START_MS; dStart <= todayStart; dStart += DAY_MS) {
      const dEnd  = dStart + DAY_MS
      const d     = new Date(dStart)
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      const count = c.listings.filter((l) => {
        if (!l.soldAt) return false
        if (!l.address) return false  // exclude placeholders (sold-N etc.)
        const t = l.soldAt.getTime()
        return t >= dStart && t < dEnd
      }).length
      salesByWeek.push({ week: label, sold: count })
    }

    return {
      id: c.id,
      name: c.name,
      city: c.city,
      state: c.state,
      url: c.url,
      builderName: c.builder.name,
      firstDetected: c.firstDetected,
      totalReleased: total,
      sold,
      active,
      future,
      salesPerMonth,
      trackedSales: observedSales.length,
      avgDaysOnMarket,
      minPrice,
      maxPrice,
      salesByWeek,
    }
  })

  return NextResponse.json(result)
}
