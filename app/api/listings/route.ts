import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSheetLookup, resolveSheetRow } from "@/lib/sheets"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const status = searchParams.get("status") || "active"
  const minPrice = searchParams.get("minPrice") ? parseInt(searchParams.get("minPrice")!) : undefined
  const maxPrice = searchParams.get("maxPrice") ? parseInt(searchParams.get("maxPrice")!) : undefined
  const minBeds = searchParams.get("minBeds") ? parseFloat(searchParams.get("minBeds")!) : undefined
  const minSqft = searchParams.get("minSqft") ? parseInt(searchParams.get("minSqft")!) : undefined
  const maxSqft = searchParams.get("maxSqft") ? parseInt(searchParams.get("maxSqft")!) : undefined
  const floors = searchParams.get("floors") ? parseInt(searchParams.get("floors")!) : undefined
  const communityId = searchParams.get("communityId") ? parseInt(searchParams.get("communityId")!) : undefined
  const sortBy = searchParams.get("sortBy") || "firstDetected"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"

  const EXCLUDED_BUILDERS = ["Bonanni Development", "City Ventures", "Brandywine Homes", "Olson Homes", "Risewell Homes"]

  const where: Record<string, unknown> = {
    community: { builder: { name: { notIn: EXCLUDED_BUILDERS } } }
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

  const [listings, sheetLookup] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: { community: { select: { name: true, city: true, state: true, builder: { select: { name: true } } } } },
      orderBy: { [orderByField]: sortDir },
      take: 500,
    }),
    getSheetLookup(),
  ])

  // Overlay sheet values (property type, HOA, taxes) on top of DB values
  const merged = listings.map((l) => {
    const sheet = resolveSheetRow(sheetLookup, l.community.name, l.floorPlan)
    if (!sheet) return l
    return {
      ...l,
      propertyType: sheet.propertyType || l.propertyType,
      hoaFees: sheet.hoa ?? l.hoaFees,
      taxes: (sheet.taxRate && l.currentPrice)
        ? Math.round(l.currentPrice * sheet.taxRate / 100)
        : sheet.annualTax ?? l.taxes,
    }
  })

  return NextResponse.json(merged)
}
