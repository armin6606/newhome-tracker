import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

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

  const result = communities.map((c) => {
    // Placeholder lots (lotNumber matches sold-N/avail-N/future-N) drive community card counts.
    // Real listings from scrapers power listing detail pages.
    // If no placeholders exist yet, fall back to counting all listings.
    const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/
    const placeholders   = c.listings.filter((l) => l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber))
    const countSource    = placeholders.length > 0 ? placeholders : c.listings

    const active  = countSource.filter((l) => l.status === "active").length
    const sold    = countSource.filter((l) => l.status === "sold").length
    const future  = countSource.filter((l) => l.status === "future").length
    const total   = countSource.filter((l) => l.status !== "removed").length

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
