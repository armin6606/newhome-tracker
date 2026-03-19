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
    }
  })

  return NextResponse.json(result)
}
