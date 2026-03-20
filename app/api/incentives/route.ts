import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/** Normalize incentive text for grouping: trim, collapse whitespace, strip trailing punctuation */
function normalizeOffer(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const builder = searchParams.get("builder") || ""
  const city = searchParams.get("city") || ""

  // Get all communities with active listings that have incentives
  const communities = await prisma.community.findMany({
    where: {
      listings: {
        some: {
          status: "active",
          incentives: { not: null },
        },
      },
      ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
      ...(builder ? { builder: { name: { contains: builder, mode: "insensitive" } } } : {}),
    },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      url: true,
      builder: { select: { name: true } },
      listings: {
        where: { status: "active", incentives: { not: null } },
        select: { incentives: true, currentPrice: true },
        orderBy: { currentPrice: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  // Group by unique offer text → list of eligible communities
  const offerMap = new Map<string, {
    offerText: string
    builder: string
    communities: { id: number; name: string; city: string; state: string; url: string; activeCount: number; minPrice: number | null; maxPrice: number | null }[]
  }>()

  for (const c of communities) {
    const rawOffer = c.listings[0]?.incentives
    if (!rawOffer) continue

    const normalized = normalizeOffer(rawOffer)
    const key = `${c.builder.name}::${normalized}`

    const prices = c.listings.map((l) => l.currentPrice).filter((p): p is number => p != null)
    const communityEntry = {
      id: c.id,
      name: c.name,
      city: c.city,
      state: c.state,
      url: c.url,
      activeCount: c.listings.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
    }

    if (offerMap.has(key)) {
      offerMap.get(key)!.communities.push(communityEntry)
    } else {
      offerMap.set(key, {
        offerText: rawOffer,
        builder: c.builder.name,
        communities: [communityEntry],
      })
    }
  }

  const grouped = Array.from(offerMap.values()).sort((a, b) => {
    // Sort by number of eligible communities (most first), then builder name
    if (b.communities.length !== a.communities.length) return b.communities.length - a.communities.length
    return a.builder.localeCompare(b.builder)
  })

  return NextResponse.json(grouped)
}
