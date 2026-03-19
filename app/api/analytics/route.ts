import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const city      = searchParams.get("city")      || ""
  const builder   = searchParams.get("builder")   || ""
  const community = searchParams.get("community") || ""

  const EXCLUDED_BUILDERS = ["Bonanni Development", "City Ventures"]

  const communityWhere: Record<string, unknown> = {
    builder: { name: { notIn: EXCLUDED_BUILDERS } }
  }
  if (city)      communityWhere.city    = { contains: city,      mode: "insensitive" }
  if (builder)   communityWhere.builder = { name: { contains: builder, mode: "insensitive" } }
  if (community) communityWhere.name    = { contains: community, mode: "insensitive" }

  const where: Record<string, unknown> = { community: communityWhere }

  const listings = await prisma.listing.findMany({
    where,
    select: {
      id: true, status: true, currentPrice: true, pricePerSqft: true,
      sqft: true, beds: true, firstDetected: true, soldAt: true, communityId: true,
      community: { select: { name: true, city: true, builder: { select: { name: true } } } },
    },
  })

  // Active-only subset — used for price charts for accuracy
  const active = listings.filter((l) => l.status === "active")

  // ── Scatter: price vs sqft (active only) ────────────────────────────────
  const scatterData = active
    .filter((l) => l.currentPrice && l.sqft)
    .map((l) => ({ sqft: l.sqft!, price: l.currentPrice!, community: l.community.name }))

  // ── Avg $/sqft by community (active only) ────────────────────────────────
  const ppsqMap: Record<string, { total: number; count: number }> = {}
  active.filter((l) => l.pricePerSqft).forEach((l) => {
    const n = l.community.name
    if (!ppsqMap[n]) ppsqMap[n] = { total: 0, count: 0 }
    ppsqMap[n].total += l.pricePerSqft!
    ppsqMap[n].count++
  })
  const avgPricePerSqftByCommunity = Object.entries(ppsqMap)
    .map(([community, { total, count }]) => ({ community, avgPricePerSqft: Math.round(total / count) }))
    .sort((a, b) => b.avgPricePerSqft - a.avgPricePerSqft)

  // ── Price range by community (active only) ───────────────────────────────
  const priceRangeMap: Record<string, { min: number; max: number; total: number; count: number }> = {}
  active.filter((l) => l.currentPrice).forEach((l) => {
    const n = l.community.name
    if (!priceRangeMap[n]) priceRangeMap[n] = { min: l.currentPrice!, max: l.currentPrice!, total: 0, count: 0 }
    priceRangeMap[n].min   = Math.min(priceRangeMap[n].min, l.currentPrice!)
    priceRangeMap[n].max   = Math.max(priceRangeMap[n].max, l.currentPrice!)
    priceRangeMap[n].total += l.currentPrice!
    priceRangeMap[n].count++
  })
  const priceRangeByCommunity = Object.entries(priceRangeMap)
    .map(([community, { min, max, total, count }]) => ({
      community, min, max, avg: Math.round(total / count), count,
    }))
    .sort((a, b) => a.avg - b.avg)

  // ── Avg price over time (active only) ────────────────────────────────────
  const priceByMonth: Record<string, { total: number; count: number }> = {}
  active.filter((l) => l.currentPrice).forEach((l) => {
    const key = l.firstDetected.toISOString().slice(0, 7)
    if (!priceByMonth[key]) priceByMonth[key] = { total: 0, count: 0 }
    priceByMonth[key].total += l.currentPrice!
    priceByMonth[key].count++
  })
  const avgPriceByMonth = Object.entries(priceByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, count }]) => ({ month, avgPrice: Math.round(total / count) }))

  // ── Homes sold over time ─────────────────────────────────────────────────
  const soldByMonth: Record<string, number> = {}
  listings.filter((l) => l.soldAt).forEach((l) => {
    const key = l.soldAt!.toISOString().slice(0, 7)
    soldByMonth[key] = (soldByMonth[key] || 0) + 1
  })

  // ── Community summary ────────────────────────────────────────────────────
  const communityMap: Record<string, {
    name: string; builderName: string; active: number; sold: number;
    prices: number[]; ppsqft: number[]; sqfts: number[]
  }> = {}
  listings.forEach((l) => {
    const n = l.community.name
    if (!communityMap[n]) communityMap[n] = {
      name: n, builderName: l.community.builder.name,
      active: 0, sold: 0, prices: [], ppsqft: [], sqfts: [],
    }
    if (l.status === "active") communityMap[n].active++
    else communityMap[n].sold++
    if (l.status === "active" && l.currentPrice) communityMap[n].prices.push(l.currentPrice)
    if (l.status === "active" && l.pricePerSqft)  communityMap[n].ppsqft.push(l.pricePerSqft)
    if (l.sqft) communityMap[n].sqfts.push(l.sqft)
  })
  const communitySummary = Object.values(communityMap).map((c) => ({
    name: c.name, builderName: c.builderName,
    active: c.active, sold: c.sold, total: c.active + c.sold,
    avgPrice: c.prices.length ? Math.round(c.prices.reduce((a, b) => a + b, 0) / c.prices.length) : null,
    minPrice: c.prices.length ? Math.min(...c.prices) : null,
    maxPrice: c.prices.length ? Math.max(...c.prices) : null,
    avgPpsqft: c.ppsqft.length ? Math.round(c.ppsqft.reduce((a, b) => a + b, 0) / c.ppsqft.length) : null,
    avgSqft: c.sqfts.length ? Math.round(c.sqfts.reduce((a, b) => a + b, 0) / c.sqfts.length) : null,
  })).sort((a, b) => b.total - a.total)

  return NextResponse.json({
    scatterData,
    avgPricePerSqftByCommunity,
    priceRangeByCommunity,
    avgPriceByMonth,
    soldByMonth: Object.entries(soldByMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count })),
    communitySummary,
    totalActive:   listings.filter((l) => l.status === "active").length,
    totalSold:     listings.filter((l) => l.status !== "active").length,
    totalListings: listings.length,
  })
}
