import { prisma } from "@/lib/db"
import type { ScrapedListing } from "./toll-brothers"

export async function detectAndApplyChanges(
  scrapedListings: ScrapedListing[],
  communityId: number
) {
  // Get all currently active listings in this community
  const existing = await prisma.listing.findMany({
    where: { communityId, status: "active" },
  })

  const existingByAddress = new Map(existing.map((l) => [normalizeAddress(l.address), l]))
  const scrapedAddresses = new Set(scrapedListings.map((l) => normalizeAddress(l.address)))

  const stats = { added: 0, priceChanges: 0, removed: 0, unchanged: 0 }

  // Process each scraped listing
  for (const scraped of scrapedListings) {
    const key = normalizeAddress(scraped.address)
    const existing = existingByAddress.get(key)

    if (!existing) {
      // New listing — use upsert to handle any duplicate addresses gracefully
      const listing = await prisma.listing.upsert({
        where: { communityId_address: { communityId, address: scraped.address } },
        create: {
          communityId,
          address: scraped.address,
          lotNumber: scraped.lotNumber,
          floorPlan: scraped.floorPlan,
          sqft: scraped.sqft,
          beds: scraped.beds,
          baths: scraped.baths,
          garages: scraped.garages,
          floors: scraped.floors,
          currentPrice: scraped.price,
          pricePerSqft: scraped.pricePerSqft,
          hoaFees: scraped.hoaFees,
          taxes: scraped.taxes,
          moveInDate: scraped.moveInDate,
          schools: scraped.schools,
          incentives: scraped.incentives,
          sourceUrl: scraped.sourceUrl,
          status: "active",
        },
        update: { status: "active" },
      })
      if (scraped.price) {
        const existingPrice = await prisma.priceHistory.findFirst({ where: { listingId: listing.id } })
        if (!existingPrice) {
          await prisma.priceHistory.create({
            data: { listingId: listing.id, price: scraped.price, changeType: "initial" },
          })
        }
      }
      stats.added++
    } else {
      // Existing listing — check for price change
      const updates: Record<string, unknown> = {
        lotNumber: scraped.lotNumber ?? existing.lotNumber,
        floorPlan: scraped.floorPlan ?? existing.floorPlan,
        sqft: scraped.sqft ?? existing.sqft,
        beds: scraped.beds ?? existing.beds,
        baths: scraped.baths ?? existing.baths,
        garages: scraped.garages ?? existing.garages,
        floors: scraped.floors ?? existing.floors,
        pricePerSqft: scraped.pricePerSqft ?? existing.pricePerSqft,
        hoaFees: scraped.hoaFees ?? existing.hoaFees,
        taxes: scraped.taxes ?? existing.taxes,
        moveInDate: scraped.moveInDate ?? existing.moveInDate,
        schools: scraped.schools ?? existing.schools,
        incentives: scraped.incentives ?? existing.incentives,
        sourceUrl: scraped.sourceUrl ?? existing.sourceUrl,
      }

      if (scraped.price && scraped.price !== existing.currentPrice) {
        const changeType =
          !existing.currentPrice
            ? "initial"
            : scraped.price > existing.currentPrice
            ? "increase"
            : "decrease"

        updates.currentPrice = scraped.price
        await prisma.priceHistory.create({
          data: { listingId: existing.id, price: scraped.price, changeType },
        })
        stats.priceChanges++
      } else {
        stats.unchanged++
      }

      await prisma.listing.update({ where: { id: existing.id }, data: updates })
    }
  }

  // Mark listings no longer in scrape as removed
  for (const [key, listing] of existingByAddress.entries()) {
    if (!scrapedAddresses.has(key)) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "removed", soldAt: new Date() },
      })
      stats.removed++
    }
  }

  return stats
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/\s+/g, " ").trim()
}
