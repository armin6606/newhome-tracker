import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sortBy = searchParams.get("sortBy") || "community"
  const sortDir = (searchParams.get("sortDir") || "asc") as "asc" | "desc"
  const builder = searchParams.get("builder") || ""
  const city = searchParams.get("city") || ""

  // Get distinct communities that have at least one active listing with incentives
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
    orderBy:
      sortBy === "city"
        ? { city: sortDir }
        : sortBy === "builder"
        ? { builder: { name: sortDir } }
        : { name: sortDir },
  })

  const result = communities.map((c) => {
    const prices = c.listings.map((l) => l.currentPrice).filter((p): p is number => p != null)
    return {
      id: c.id,
      name: c.name,
      city: c.city,
      state: c.state,
      url: c.url,
      builder: c.builder,
      incentives: c.listings[0]?.incentives ?? null,
      activeCount: c.listings.length,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
    }
  })

  return NextResponse.json(result)
}
