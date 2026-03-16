import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  const [priceHistory, listings, communities] = await Promise.all([
    prisma.priceHistory.findMany({
      orderBy: { detectedAt: "asc" },
      include: { listing: { select: { communityId: true, community: { select: { name: true } } } } },
    }),
    prisma.listing.findMany({
      select: {
        id: true,
        status: true,
        currentPrice: true,
        pricePerSqft: true,
        sqft: true,
        firstDetected: true,
        soldAt: true,
        communityId: true,
        community: { select: { name: true } },
      },
    }),
    prisma.community.findMany({ select: { id: true, name: true } }),
  ])

  // Homes sold over time (by month)
  const soldByMonth: Record<string, number> = {}
  listings
    .filter((l) => l.soldAt)
    .forEach((l) => {
      const key = l.soldAt!.toISOString().slice(0, 7) // YYYY-MM
      soldByMonth[key] = (soldByMonth[key] || 0) + 1
    })

  // Inventory over time — approximate by tracking active counts per week (simplified: just current)
  const activeByMonth: Record<string, number> = {}
  listings.forEach((l) => {
    const key = l.firstDetected.toISOString().slice(0, 7)
    activeByMonth[key] = (activeByMonth[key] || 0) + 1
  })

  // Avg price per sqft by community
  const ppsqftByCommunity: Record<string, { total: number; count: number }> = {}
  listings
    .filter((l) => l.pricePerSqft)
    .forEach((l) => {
      const name = l.community.name
      if (!ppsqftByCommunity[name]) ppsqftByCommunity[name] = { total: 0, count: 0 }
      ppsqftByCommunity[name].total += l.pricePerSqft!
      ppsqftByCommunity[name].count++
    })

  const avgPricePerSqftByCommunity = Object.entries(ppsqftByCommunity).map(([name, { total, count }]) => ({
    community: name,
    avgPricePerSqft: Math.round(total / count),
  }))

  // Price trend over time (avg listing price by month)
  const priceSumByMonth: Record<string, { total: number; count: number }> = {}
  listings
    .filter((l) => l.currentPrice)
    .forEach((l) => {
      const key = l.firstDetected.toISOString().slice(0, 7)
      if (!priceSumByMonth[key]) priceSumByMonth[key] = { total: 0, count: 0 }
      priceSumByMonth[key].total += l.currentPrice!
      priceSumByMonth[key].count++
    })

  const avgPriceByMonth = Object.entries(priceSumByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, count }]) => ({ month, avgPrice: Math.round(total / count) }))

  return NextResponse.json({
    soldByMonth: Object.entries(soldByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
    activeByMonth: Object.entries(activeByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
    avgPricePerSqftByCommunity,
    avgPriceByMonth,
    totalActive: listings.filter((l) => l.status === "active").length,
    totalSold: listings.filter((l) => l.status !== "active").length,
    totalListings: listings.length,
  })
}
