import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const status      = searchParams.get("status") || "active"
  const minPrice    = searchParams.get("minPrice") ? parseInt(searchParams.get("minPrice")!) : undefined
  const maxPrice    = searchParams.get("maxPrice") ? parseInt(searchParams.get("maxPrice")!) : undefined
  const minBeds     = searchParams.get("minBeds") ? parseFloat(searchParams.get("minBeds")!) : undefined
  const minSqft     = searchParams.get("minSqft") ? parseInt(searchParams.get("minSqft")!) : undefined
  const maxSqft     = searchParams.get("maxSqft") ? parseInt(searchParams.get("maxSqft")!) : undefined
  const floors      = searchParams.get("floors") ? parseInt(searchParams.get("floors")!) : undefined
  const communityId = searchParams.get("communityId") ? parseInt(searchParams.get("communityId")!) : undefined
  const sortBy      = searchParams.get("sortBy") || "firstDetected"
  const sortDir     = searchParams.get("sortDir") === "asc" ? "asc" : "desc"

  // Exclude placeholder lots — null address or placeholder-pattern address (avail-N, sold-N, future-N)
  const where: Record<string, unknown> = {
    address: { not: null },
    NOT: [
      { address: { startsWith: "avail-" } },
      { address: { startsWith: "sold-" } },
      { address: { startsWith: "future-" } },
    ],
  }
  if (status !== "all") where.status = status
  if (minPrice || maxPrice) {
    where.currentPrice = {}
    if (minPrice) (where.currentPrice as Record<string, number>).gte = minPrice
    if (maxPrice) (where.currentPrice as Record<string, number>).lte = maxPrice
  }
  if (minBeds) where.beds = { gte: minBeds }
  if (minSqft || maxSqft) {
    where.sqft = {}
    if (minSqft) (where.sqft as Record<string, number>).gte = minSqft
    if (maxSqft) (where.sqft as Record<string, number>).lte = maxSqft
  }
  if (floors) where.floors = floors
  if (communityId) where.communityId = communityId

  const validSortFields = ["currentPrice", "firstDetected", "sqft", "beds", "pricePerSqft", "floors"]
  const orderByField = validSortFields.includes(sortBy) ? sortBy : "firstDetected"
  // nulls:"last" only valid for nullable fields — firstDetected/beds are non-nullable
  const nonNullable = ["firstDetected", "beds"]
  const orderByValue = nonNullable.includes(orderByField)
    ? sortDir
    : { sort: sortDir, nulls: "last" as const }

  const listings = await prisma.listing.findMany({
    where,
    include: {
      community: {
        select: { name: true, city: true, state: true, builder: { select: { name: true } } },
      },
    },
    orderBy: { [orderByField]: orderByValue },
    take: 500,
  })

  const result = listings.map(l => ({
    ...l,
    pricePerSqft: (l.currentPrice && l.sqft) ? Math.round(l.currentPrice / l.sqft) : null,
  }))
  return NextResponse.json(result)
}
