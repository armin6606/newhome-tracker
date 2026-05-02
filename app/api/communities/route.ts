import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isSheetVerified, BUILDER_SHEET_TABS } from "@/lib/sheet-validator"

// Only fetch fields needed for community cards — avoids loading incentives/sourceUrl/etc.
const LISTING_SELECT = {
  id:            true,
  address:       true,
  lotNumber:     true,
  status:        true,
  currentPrice:  true,
  firstDetected: true,
  soldAt:        true,
} as const

// salesByWeek: show from fixed tracking start date so the chart is consistent
// across all page loads (not a rolling window that shifts every day).
const CHART_START_MS = new Date("2026-03-25T00:00:00Z").getTime()
const DAY_MS         = 24 * 60 * 60 * 1000
const PLACEHOLDER_RE    = /^(sold|avail|future)-\d+$/

// One warn-once set per process so placeholder-mismatch warnings don't flood logs
const warnedCommunities = new Set<string>()

export async function GET() {
  try {
    // ── Single DB query — load all communities + only the listing fields we need ──
    const communities = await prisma.community.findMany({
      include: {
        builder: { select: { name: true } },
        listings: { select: LISTING_SELECT },
      },
      orderBy: { name: "asc" },
    })

    // ── Sheet guardrail: verify each builder tab once, not once per community ──
    // Group communities by builder so we fire one isSheetVerified call per
    // builder tab (which hits the 10-min in-memory cache) rather than N calls.
    const builderVerified = new Map<string, boolean>()
    const uniqueBuilders  = [...new Set(communities.map((c) => c.builder.name))]
    await Promise.all(
      uniqueBuilders.map(async (builderName) => {
        if (!BUILDER_SHEET_TABS[builderName]) {
          builderVerified.set(builderName, false)
          return
        }
        // isSheetVerified fetches the tab once and caches it; subsequent
        // communities on the same builder tab hit cache instantly.
        const ok = await isSheetVerified(builderName, communities.find(c => c.builder.name === builderName)!.name)
        builderVerified.set(builderName, ok)
      })
    )

    // Re-verify each community against the cached sheet data (now all in cache)
    const verified = await Promise.all(
      communities.map(async (c) => {
        if (!BUILDER_SHEET_TABS[c.builder.name]) return { c, ok: false }
        const ok = await isSheetVerified(c.builder.name, c.name)
        return { c, ok }
      })
    )

    // Fallback: if sheet returned 0 valid communities (sheet down / network error),
    // trust the DB — the cleanup script ensures it only contains valid communities.
    const sheetVerifiedCount = verified.filter((v) => v.ok).length
    const sheetAppearsDown   = sheetVerifiedCount === 0 && communities.length > 0

    if (sheetAppearsDown) {
      console.warn(
        `[communities] Sheet verification returned 0 results for ${communities.length} DB communities. ` +
        `Sheet may be down — falling back to DB (cleanup ensures DB is clean).`
      )
    }

    const allowedCommunities = sheetAppearsDown
      ? communities.filter((c) => !!BUILDER_SHEET_TABS[c.builder.name])
      : verified.filter((v) => v.ok).map((v) => v.c)

    // ── Build response for each community ────────────────────────────────────
    const result = allowedCommunities.map((c) => {
      // ── Placeholder lots — Table 2 source of truth for Total and Future ──
      const placeholders = c.listings.filter(
        (l) => l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber)
      )

      // Total, Sold, Future: always from Table 2 (placeholder lots)
      // When the scraper observes a real active→sold transition it flips one
      // avail-N placeholder to sold, keeping these counts in sync automatically.
      const sold   = placeholders.filter((l) => l.status === "sold").length
      const future = placeholders.filter((l) => l.status === "future").length
      const total  = placeholders.filter((l) => l.status !== "removed").length

      // ── For Sale — from real (scraped) listings on the listing page ──────────
      // A real listing: has an address and is NOT a placeholder lot number.
      const active = c.listings.filter(
        (l) =>
          l.address !== null &&
          !(l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber)) &&
          l.status === "active"
      ).length

      // Guard: clamp firstDetected to now so future-dated entries don't skew stats
      const rawStart     = c.firstDetected?.getTime() ?? Date.now()
      const trackingStart = new Date(Math.min(rawStart, Date.now()))

      // salesPerMonth: only meaningful if we have at least 7 days of data
      const observedSales = c.listings.filter(
        (l) =>
          l.status === "sold" &&
          l.soldAt !== null &&
          l.soldAt >= trackingStart &&
          l.address !== null
      )
      let salesPerMonth = 0
      const trackingAgeMs = Date.now() - trackingStart.getTime()
      if (observedSales.length > 0 && trackingAgeMs >= 7 * DAY_MS) {
        const spanMonths = trackingAgeMs / (DAY_MS * 30)
        salesPerMonth    = parseFloat((observedSales.length / spanMonths).toFixed(1))
      }

      const soldWithDates  = c.listings.filter((l) => l.status === "sold" && l.soldAt && l.firstDetected)
      const avgDaysOnMarket =
        soldWithDates.length > 0
          ? Math.round(
              soldWithDates.reduce(
                (sum, l) =>
                  sum + (l.soldAt!.getTime() - l.firstDetected.getTime()) / DAY_MS,
                0
              ) / soldWithDates.length
            )
          : null

      // Use reduce instead of spread to avoid call-stack overflow on large arrays
      const prices = c.listings
        .map((l) => l.currentPrice)
        .filter((p): p is number => p !== null && p > 0)
      const minPrice = prices.length ? prices.reduce((m, p) => (p < m ? p : m), prices[0]) : null
      const maxPrice = prices.length ? prices.reduce((m, p) => (p > m ? p : m), prices[0]) : null

      // ── salesByWeek: last SALES_WINDOW_DAYS only ────────────────────────────
      // Pre-build a date→count map so we do one pass over listings instead of
      // one filter-pass per day (avoids O(communities × days × listings) cost).
      const soldDateMap = new Map<string, number>()
      for (const l of c.listings) {
        if (l.status !== "sold" || !l.soldAt || !l.address) continue  // only real sold listings
        // Skip lots that were already sold at first ingestion — soldAt equals firstDetected
        // because we never observed the active→sold transition. These cause a false spike
        // on the day tracking started. Only plot sales we actually witnessed.
        if (Math.abs(l.soldAt.getTime() - l.firstDetected.getTime()) < DAY_MS) continue
        const d     = l.soldAt
        const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        soldDateMap.set(label, (soldDateMap.get(label) ?? 0) + 1)
      }

      const salesByWeek: { week: string; sold: number }[] = []
      for (let dStart = CHART_START_MS; dStart <= Date.now(); dStart += DAY_MS) {
        const d     = new Date(dStart)
        const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        salesByWeek.push({ week: label, sold: soldDateMap.get(label) ?? 0 })
      }

      return {
        id:             c.id,
        name:           c.name,
        city:           c.city,
        state:          c.state,
        url:            c.url,
        builderName:    c.builder.name,
        firstDetected:  c.firstDetected,
        totalReleased:  total,
        sold,
        active,
        future,
        salesPerMonth,
        trackedSales:   observedSales.length,
        avgDaysOnMarket,
        minPrice,
        maxPrice,
        salesByWeek,
      }
    })

    return NextResponse.json(result, {
      headers: {
        // 60-second CDN cache; community cards don't need real-time accuracy.
        // stale-while-revalidate serves cached data while the next fetch runs.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "Vary": "Accept-Encoding",
      },
    })
  } catch (err) {
    console.error("[/api/communities] Unhandled error:", err)
    return NextResponse.json(
      { error: "Failed to fetch communities. Please try again." },
      { status: 500 }
    )
  }
}
