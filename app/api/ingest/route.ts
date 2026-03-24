import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * POST /api/ingest
 * Endpoint for scraping agents to push builder data.
 *
 * Expected body:
 * {
 *   builder: { name: string, websiteUrl: string },
 *   community: { name: string, city: string, state: string, url: string },
 *   listings: Array<{
 *     address?: string
 *     lotNumber?: string
 *     floorPlan?: string
 *     sqft?: number
 *     beds?: number
 *     baths?: number
 *     garages?: number
 *     floors?: number
 *     currentPrice?: number
 *     pricePerSqft?: number
 *     propertyType?: string
 *     hoaFees?: number
 *     taxes?: number
 *     moveInDate?: string
 *     incentives?: string
 *     incentivesUrl?: string
 *     status?: "active" | "sold" | "future" | "removed"
 *     sourceUrl?: string
 *     soldAt?: string  // ISO date string
 *   }>
 * }
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret")
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { builder: builderData, community: communityData, listings: listingsData, clearPlaceholders } = body

  if (!builderData?.name || !communityData?.name || !Array.isArray(listingsData)) {
    return NextResponse.json({ error: "Invalid payload. Required: builder, community, listings[]" }, { status: 400 })
  }

  // Upsert builder
  const builder = await prisma.builder.upsert({
    where: { name: builderData.name },
    create: { name: builderData.name, websiteUrl: builderData.websiteUrl || "" },
    update: { websiteUrl: builderData.websiteUrl || "" },
  })

  // Upsert community
  const community = await prisma.community.upsert({
    where: { builderId_name: { builderId: builder.id, name: communityData.name } },
    create: {
      builderId: builder.id,
      name:  communityData.name,
      city:  communityData.city || "",
      state: communityData.state || "CA",
      url:   communityData.url || "",
    },
    update: {
      city:  communityData.city || "",
      state: communityData.state || "CA",
      url:   communityData.url || "",
    },
  })

  // When clearPlaceholders=true, delete all null-address (placeholder) listings first
  if (clearPlaceholders) {
    await prisma.listing.deleteMany({
      where: { communityId: community.id, address: null },
    })
  }

  const results = { created: 0, updated: 0, priceChanges: 0 }

  for (const l of listingsData) {
    const status = l.status || "active"

    // Need at least address or lotNumber+floorPlan to identify a listing
    const address = l.address || null

    // Try to find existing listing
    const existing = address
      ? await prisma.listing.findUnique({ where: { communityId_address: { communityId: community.id, address } } })
      : null

    const soldAt = l.soldAt ? new Date(l.soldAt) : (status === "sold" ? new Date() : null)

    if (existing) {
      // Track price change
      if (l.currentPrice && existing.currentPrice && l.currentPrice !== existing.currentPrice) {
        const changeType = l.currentPrice > existing.currentPrice ? "increase" : "decrease"
        await prisma.priceHistory.create({
          data: { listingId: existing.id, price: l.currentPrice, changeType },
        })
        results.priceChanges++
      }

      await prisma.listing.update({
        where: { id: existing.id },
        data: {
          lotNumber:     l.lotNumber     ?? existing.lotNumber,
          floorPlan:     l.floorPlan     ?? existing.floorPlan,
          sqft:          l.sqft          ?? existing.sqft,
          beds:          l.beds          ?? existing.beds,
          baths:         l.baths         ?? existing.baths,
          garages:       l.garages       ?? existing.garages,
          floors:        l.floors        ?? existing.floors,
          currentPrice:  l.currentPrice  ?? existing.currentPrice,
          pricePerSqft:  l.pricePerSqft  ?? existing.pricePerSqft,
          propertyType:  l.propertyType  ?? existing.propertyType,
          hoaFees:       l.hoaFees       ?? existing.hoaFees,
          taxes:         l.taxes         ?? existing.taxes,
          moveInDate:    l.moveInDate    ?? existing.moveInDate,
          incentives:    l.incentives    ?? existing.incentives,
          incentivesUrl: l.incentivesUrl ?? existing.incentivesUrl,
          status,
          sourceUrl:     l.sourceUrl     ?? existing.sourceUrl,
          soldAt:        soldAt          ?? existing.soldAt,
        },
      })
      results.updated++
    } else {
      const created = await prisma.listing.create({
        data: {
          communityId:   community.id,
          address,
          lotNumber:     l.lotNumber    || null,
          floorPlan:     l.floorPlan    || null,
          sqft:          l.sqft         || null,
          beds:          l.beds         || null,
          baths:         l.baths        || null,
          garages:       l.garages      || null,
          floors:        l.floors       || null,
          currentPrice:  l.currentPrice || null,
          pricePerSqft:  l.pricePerSqft || null,
          propertyType:  l.propertyType || null,
          hoaFees:       l.hoaFees      || null,
          taxes:         l.taxes        || null,
          moveInDate:    l.moveInDate   || null,
          incentives:    l.incentives   || null,
          incentivesUrl: l.incentivesUrl|| null,
          status,
          sourceUrl:     l.sourceUrl    || null,
          soldAt,
        },
      })

      // Record initial price
      if (l.currentPrice) {
        await prisma.priceHistory.create({
          data: { listingId: created.id, price: l.currentPrice, changeType: "initial" },
        })
      }
      results.created++
    }
  }

  return NextResponse.json({
    ok: true,
    community: community.name,
    builder: builder.name,
    ...results,
  })
}
