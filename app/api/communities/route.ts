import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const EXCLUDED_BUILDERS = ["Bonanni Development", "City Ventures"]

  const communities = await prisma.community.findMany({
    where: { builder: { name: { notIn: EXCLUDED_BUILDERS } } },
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
    const total = c.listings.length
    const sold = c.listings.filter((l) => l.status !== "active").length
    const active = c.listings.filter((l) => l.status === "active").length

    // Sales pace: sold homes / months since first listing detected
    const firstDate = c.firstDetected
    const monthsSinceStart = Math.max(
      1,
      (Date.now() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    )
    const salesPerMonth = parseFloat((sold / monthsSinceStart).toFixed(1))

    // Average days on market (for sold listings with soldAt)
    const soldWithDates = c.listings.filter((l) => l.soldAt && l.firstDetected)
    const avgDaysOnMarket =
      soldWithDates.length > 0
        ? Math.round(
            soldWithDates.reduce((sum, l) => {
              return sum + (l.soldAt!.getTime() - l.firstDetected.getTime()) / (1000 * 60 * 60 * 24)
            }, 0) / soldWithDates.length
          )
        : null

    const prices = c.listings.map((l) => l.currentPrice).filter(Boolean) as number[]
    const minPrice = prices.length ? Math.min(...prices) : null
    const maxPrice = prices.length ? Math.max(...prices) : null

    // Weekly sales for the last 12 weeks
    function getWeekStart(d: Date): number {
      const day = d.getUTCDay()
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).getTime()
    }
    const now = new Date()
    const thisWeek = getWeekStart(now)
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const salesByWeek: { week: string; sold: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const wStart = thisWeek - i * WEEK_MS
      const wEnd = wStart + WEEK_MS
      const d = new Date(wStart)
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
      salesPerMonth,
      avgDaysOnMarket,
      minPrice,
      maxPrice,
      salesByWeek,
    }
  })

  return NextResponse.json(result)
}
