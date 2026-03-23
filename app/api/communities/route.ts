import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { name: true } },
      listings: {
        select: {
          id: true,
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
    const active  = c.listings.filter((l) => l.status === "active").length
    const sold    = c.listings.filter((l) => l.status === "sold").length
    const future  = c.listings.filter((l) => l.status === "future").length
    const total   = c.listings.filter((l) => l.status !== "removed").length

    const observedSales = c.listings.filter((l) => l.soldAt !== null)
    let salesPerMonth = 0
    if (observedSales.length > 0) {
      const soldDates   = observedSales.map((l) => l.soldAt!.getTime())
      const earliest    = Math.min(...soldDates)
      const latest      = Math.max(...soldDates)
      const spanMonths  = Math.max(1, (latest - earliest) / (1000 * 60 * 60 * 24 * 30))
      salesPerMonth     = parseFloat((observedSales.length / spanMonths).toFixed(1))
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

    function getWeekStart(d: Date): number {
      const day  = d.getUTCDay()
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).getTime()
    }
    const WEEK_MS            = 7 * 24 * 60 * 60 * 1000
    const TRACKING_START_MS  = getWeekStart(new Date("2026-03-17"))
    const thisWeek           = getWeekStart(new Date())
    const salesByWeek: { week: string; sold: number }[] = []
    for (let wStart = TRACKING_START_MS; wStart <= thisWeek; wStart += WEEK_MS) {
      const wEnd  = wStart + WEEK_MS
      const d     = new Date(wStart)
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      const count = c.listings.filter((l) => {
        if (!l.soldAt) return false
        const t = l.soldAt.getTime()
        return t >= wStart && t < wEnd
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
      avgDaysOnMarket,
      minPrice,
      maxPrice,
      salesByWeek,
    }
  })

  return NextResponse.json(result)
}
