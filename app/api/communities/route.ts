import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isRealListing, isVisibleCommunity } from "@/lib/site-visibility"

const LISTING_SELECT = {
  id: true,
  address: true,
  lotNumber: true,
  status: true,
  currentPrice: true,
  firstDetected: true,
  soldAt: true,
} as const

const CHART_START_MS = new Date("2026-03-25T00:00:00Z").getTime()
const DAY_MS = 24 * 60 * 60 * 1000

export async function GET() {
  try {
    const communities = await prisma.community.findMany({
      include: {
        builder: { select: { name: true } },
        listings: { select: LISTING_SELECT },
      },
      orderBy: { name: "asc" },
    })

    const allowedCommunities = communities.filter(isVisibleCommunity)

    const result = allowedCommunities.map((c) => {
      const sold = c.listings.filter((l) => isRealListing(l) && l.status === "sold").length
      const active = c.listings.filter((l) => isRealListing(l) && l.currentPrice !== null && l.status === "for sale").length
      const future = c.listings.filter((l) => isRealListing(l) && l.status === "future").length
      const total = sold + active + future

      const rawStart = c.firstDetected?.getTime() ?? Date.now()
      const trackingStart = new Date(Math.min(rawStart, Date.now()))

      const observedSales = c.listings.filter(
        (l) =>
          isRealListing(l) &&
          l.status === "sold" &&
          l.soldAt !== null &&
          l.soldAt >= trackingStart
      )

      let salesPerMonth = 0
      const trackingAgeMs = Date.now() - trackingStart.getTime()
      if (observedSales.length > 0 && trackingAgeMs >= 7 * DAY_MS) {
        const spanMonths = trackingAgeMs / (DAY_MS * 30)
        salesPerMonth = parseFloat((observedSales.length / spanMonths).toFixed(1))
      }

      const soldWithDates = c.listings.filter((l) => l.status === "sold" && l.soldAt && l.firstDetected)
      const avgDaysOnMarket =
        soldWithDates.length > 0
          ? Math.round(
              soldWithDates.reduce(
                (sum, l) => sum + (l.soldAt!.getTime() - l.firstDetected.getTime()) / DAY_MS,
                0
              ) / soldWithDates.length
            )
          : null

      const prices = c.listings
        .map((l) => l.currentPrice)
        .filter((p): p is number => p !== null && p > 0)
      const minPrice = prices.length ? prices.reduce((m, p) => (p < m ? p : m), prices[0]) : null
      const maxPrice = prices.length ? prices.reduce((m, p) => (p > m ? p : m), prices[0]) : null

      const soldDateMap = new Map<string, number>()
      for (const l of c.listings) {
        if (!isRealListing(l) || l.status !== "sold" || !l.soldAt) continue
        const d = l.soldAt
        const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        soldDateMap.set(label, (soldDateMap.get(label) ?? 0) + 1)
      }

      const salesByWeek: { week: string; sold: number }[] = []
      for (let dStart = CHART_START_MS; dStart <= Date.now(); dStart += DAY_MS) {
        const d = new Date(dStart)
        const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        salesByWeek.push({ week: label, sold: soldDateMap.get(label) ?? 0 })
      }

      return {
        id: c.id,
        name: c.name,
        city: c.city,
        state: c.state,
        url: c.url,
        builderName: c.builder.name,
        firstDetected: c.firstDetected,
        lastScrapedAt: c.lastScrapedAt ?? null,
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
        countMismatch: total > 0 && sold + active + future !== total,
      }
    })

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        Vary: "Accept-Encoding",
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
