import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const status = searchParams.get("status") || "active"
  const minPrice = searchParams.get("minPrice") ? parseInt(searchParams.get("minPrice")!) : undefined
  const maxPrice = searchParams.get("maxPrice") ? parseInt(searchParams.get("maxPrice")!) : undefined
  const minBeds = searchParams.get("minBeds") ? parseFloat(searchParams.get("minBeds")!) : undefined
  const minSqft = searchParams.get("minSqft") ? parseInt(searchParams.get("minSqft")!) : undefined
  const maxSqft = searchParams.get("maxSqft") ? parseInt(searchParams.get("maxSqft")!) : undefined
  const communityId = searchParams.get("communityId") ? parseInt(searchParams.get("communityId")!) : undefined
  const sortBy = searchParams.get("sortBy") || "firstDetected"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"

  const where: Record<string, unknown> = {}
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
  if (communityId) where.communityId = communityId

  const validSortFields = ["currentPrice", "firstDetected", "sqft", "beds", "pricePerSqft"]
  const orderByField = validSortFields.includes(sortBy) ? sortBy : "firstDetected"

  const listings = await prisma.listing.findMany({
    where,
    include: { community: { select: { name: true, city: true, state: true, builder: { select: { name: true } } } } },
    orderBy: { [orderByField]: sortDir },
    take: 500,
  })

  return NextResponse.json(listings)
}
