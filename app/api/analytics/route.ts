import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

// ── Guards ────────────────────────────────────────────────────────────────────

const MAX_FILTER_VALUES = 50   // max distinct values per array param
const MAX_PARAM_LEN     = 120  // max chars per individual filter value
const MAX_LISTINGS      = 5_000
// Chart window: only show weekly/monthly data for the last 26 weeks (~6 months)
const CHART_WEEKS       = 26

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safe reduce-based min/max — no spread, no call-stack risk on large arrays */
function safeMin(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((m, v) => (v < m ? v : m), arr[0])
}
function safeMax(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((m, v) => (v > m ? v : m), arr[0])
}

function getWeekStart(date: Date): string {
  const d   = new Date(date)
  const day = d.getUTCDay()
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
  d.setUTCDate(diff)
  return d.toISOString().slice(0, 10)
}

/** Sanitise one string filter value — trim + length cap */
function sanitise(v: string): string {
  return v.trim().slice(0, MAX_PARAM_LEN)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    // Clamp array params to MAX_FILTER_VALUES and sanitise each value
    const cities      = searchParams.getAll("city")     .slice(0, MAX_FILTER_VALUES).map(sanitise).filter(Boolean)
    const builders    = searchParams.getAll("builder")  .slice(0, MAX_FILTER_VALUES).map(sanitise).filter(Boolean)
    const communities = searchParams.getAll("community").slice(0, MAX_FILTER_VALUES).map(sanitise).filter(Boolean)
    const counties    = searchParams.getAll("county")   .slice(0, MAX_FILTER_VALUES).map(sanitise).filter(Boolean)

    // Expand county → city list
    const CITY_COUNTY: Record<string, string> = {
      "irvine": "Orange County", "orange": "Orange County", "anaheim": "Orange County",
      "tustin": "Orange County", "fullerton": "Orange County", "garden grove": "Orange County",
      "huntington beach": "Orange County", "newport beach": "Orange County", "lake forest": "Orange County",
      "mission viejo": "Orange County", "aliso viejo": "Orange County", "laguna niguel": "Orange County",
      "rancho mission viejo": "Orange County", "yorba linda": "Orange County", "brea": "Orange County",
      "long beach": "Los Angeles County", "los angeles": "Los Angeles County", "torrance": "Los Angeles County",
      "hacienda heights": "Los Angeles County", "chino hills": "San Bernardino County",
      "french valley": "Riverside County", "murrieta": "Riverside County", "temecula": "Riverside County",
      "menifee": "Riverside County", "riverside": "Riverside County", "moreno valley": "Riverside County",
      "perris": "Riverside County", "winchester": "Riverside County", "wildomar": "Riverside County",
    }
    const countyCities = counties.length > 0
      ? Object.entries(CITY_COUNTY)
          .filter(([, co]) => counties.some((c) => c.toLowerCase() === co.toLowerCase()))
          .map(([city]) => city.charAt(0).toUpperCase() + city.slice(1))
      : []

    // Merge explicit city filters with county-expanded cities
    const allCities = [...new Set([...cities, ...countyCities])]

    const communityWhere: Record<string, unknown> = {}
    if (allCities.length > 0)    communityWhere.city    = { in: allCities, mode: "insensitive" }
    if (builders.length > 0)     communityWhere.builder = { name: { in: builders } }
    if (communities.length > 0)  communityWhere.name    = { in: communities }

    // Exclude placeholder lots — only real addressed listings enter the analytics
    const placeholderExclusion = {
      address: { not: null },
      NOT: [
        { address: { startsWith: "avail-" } },
        { address: { startsWith: "sold-" } },
        { address: { startsWith: "future-" } },
      ],
    }

    const where: Record<string, unknown> =
      Object.keys(communityWhere).length > 0
        ? { community: communityWhere, ...placeholderExclusion }
        : { ...placeholderExclusion }

    // Fetch with a hard cap to prevent OOM on large DBs
    const listings = await prisma.listing.findMany({
      where,
      select: {
        id: true, status: true, currentPrice: true, pricePerSqft: true,
        sqft: true, beds: true, firstDetected: true, soldAt: true, communityId: true,
        community: { select: { name: true, city: true, builder: { select: { name: true } } } },
      },
      take: MAX_LISTINGS,
      orderBy: { firstDetected: "desc" },
    })

    const truncated = listings.length === MAX_LISTINGS

    // ── Derived subsets ───────────────────────────────────────────────────────

    // Only real active listings (NOT future/removed placeholders)
    const active = listings.filter((l) => l.status === "active")
    // Only real sold listings (status === "sold" AND had a soldAt date)
    const sold   = listings.filter((l) => l.status === "sold" && l.soldAt)

    // ── Scatter: sqft vs price ────────────────────────────────────────────────

    const scatterData = active
      .filter((l) => l.currentPrice && l.sqft)
      .map((l) => ({ sqft: l.sqft!, price: l.currentPrice!, community: l.community.name }))

    // ── Avg $/sqft by community ───────────────────────────────────────────────

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

    // ── Price range by community (reduce-based, no spread) ───────────────────

    const priceRangeMap: Record<string, { min: number; max: number; total: number; count: number }> = {}
    active.filter((l) => l.currentPrice).forEach((l) => {
      const n = l.community.name
      if (!priceRangeMap[n]) {
        priceRangeMap[n] = { min: l.currentPrice!, max: l.currentPrice!, total: 0, count: 0 }
      }
      if (l.currentPrice! < priceRangeMap[n].min) priceRangeMap[n].min = l.currentPrice!
      if (l.currentPrice! > priceRangeMap[n].max) priceRangeMap[n].max = l.currentPrice!
      priceRangeMap[n].total += l.currentPrice!
      priceRangeMap[n].count++
    })
    const priceRangeByCommunity = Object.entries(priceRangeMap)
      .map(([community, { min, max, total, count }]) => ({
        community, min, max, avg: Math.round(total / count), count,
      }))
      .sort((a, b) => a.avg - b.avg)

    // ── Avg list price by month (active, capped to last 12 months) ────────────

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    const priceByMonth: Record<string, { total: number; count: number }> = {}
    active
      .filter((l) => l.currentPrice && l.firstDetected >= twelveMonthsAgo)
      .forEach((l) => {
        const key = l.firstDetected.toISOString().slice(0, 7)
        if (!priceByMonth[key]) priceByMonth[key] = { total: 0, count: 0 }
        priceByMonth[key].total += l.currentPrice!
        priceByMonth[key].count++
      })
    const avgPriceByMonth = Object.entries(priceByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { total, count }]) => ({ month, avgPrice: Math.round(total / count) }))

    // ── Sold by month (real sold lots only, last 12 months) ──────────────────

    const soldByMonth: Record<string, number> = {}
    sold
      .filter((l) => l.soldAt! >= twelveMonthsAgo)
      .forEach((l) => {
        const key = l.soldAt!.toISOString().slice(0, 7)
        soldByMonth[key] = (soldByMonth[key] || 0) + 1
      })

    // ── Weekly activity (last CHART_WEEKS weeks) ──────────────────────────────

    const chartCutoff = new Date()
    chartCutoff.setDate(chartCutoff.getDate() - CHART_WEEKS * 7)

    const soldByWeekMap: Record<string, number> = {}
    const newByWeekMap:  Record<string, number> = {}

    sold
      .filter((l) => l.soldAt! >= chartCutoff)
      .forEach((l) => {
        const key = getWeekStart(l.soldAt!)
        soldByWeekMap[key] = (soldByWeekMap[key] || 0) + 1
      })
    active
      .filter((l) => l.firstDetected >= chartCutoff)
      .forEach((l) => {
        const key = getWeekStart(l.firstDetected)
        newByWeekMap[key] = (newByWeekMap[key] || 0) + 1
      })

    const allWeekKeys = Array.from(
      new Set([...Object.keys(soldByWeekMap), ...Object.keys(newByWeekMap)])
    ).sort()
    const soldByWeek = allWeekKeys.map((weekKey) => {
      const [, m, d] = weekKey.split("-")
      return {
        week:        `${m}/${d}`,
        sold:        soldByWeekMap[weekKey] || 0,
        newListings: newByWeekMap[weekKey]  || 0,
      }
    })

    // ── Community summary (reduce-based min/max, status-correct counts) ───────

    const communityMap: Record<string, {
      name: string; builderName: string
      activeCnt: number; soldCnt: number
      prices: number[]; ppsqft: number[]; sqfts: number[]
    }> = {}

    listings.forEach((l) => {
      const n = l.community.name
      if (!communityMap[n]) {
        communityMap[n] = {
          name: n, builderName: l.community.builder.name,
          activeCnt: 0, soldCnt: 0,
          prices: [], ppsqft: [], sqfts: [],
        }
      }
      // Count only real active / sold — skip future/removed
      if (l.status === "active") communityMap[n].activeCnt++
      else if (l.status === "sold") communityMap[n].soldCnt++

      if (l.status === "active" && l.currentPrice) communityMap[n].prices.push(l.currentPrice)
      if (l.status === "active" && l.pricePerSqft)  communityMap[n].ppsqft.push(l.pricePerSqft)
      if (l.sqft) communityMap[n].sqfts.push(l.sqft)
    })

    const communitySummary = Object.values(communityMap).map((c) => ({
      name:        c.name,
      builderName: c.builderName,
      active:      c.activeCnt,
      sold:        c.soldCnt,
      total:       c.activeCnt + c.soldCnt,
      avgPrice:    c.prices.length ? Math.round(c.prices.reduce((a, b) => a + b, 0) / c.prices.length) : null,
      minPrice:    safeMin(c.prices),
      maxPrice:    safeMax(c.prices),
      avgPpsqft:   c.ppsqft.length ? Math.round(c.ppsqft.reduce((a, b) => a + b, 0) / c.ppsqft.length) : null,
      avgSqft:     c.sqfts.length  ? Math.round(c.sqfts.reduce((a, b)  => a + b, 0) / c.sqfts.length)  : null,
    })).sort((a, b) => b.total - a.total)

    return NextResponse.json(
      {
        truncated,
        scatterData,
        avgPricePerSqftByCommunity,
        priceRangeByCommunity,
        avgPriceByMonth,
        soldByMonth: Object.entries(soldByMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count })),
        soldByWeek,
        communitySummary,
        totalActive:   active.length,
        totalSold:     sold.length,
        totalListings: listings.length,
      },
      {
        headers: {
          // Analytics rarely change faster than 2 min; cache at CDN edge
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[/api/analytics] Unhandled error:", err)
    return NextResponse.json(
      { error: "Failed to load analytics data. Please try again." },
      { status: 500 }
    )
  }
}
