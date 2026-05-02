import { prisma } from "@/lib/db"
import type { ScrapedListing } from "./toll-brothers"
import { notifyPriceChange, notifyNewListings } from "./notifications"

export interface NewListingDetail {
  address: string | null
  lotNumber: string | null
  community: string
  builder: string
  price: number | null
}

export interface PriceChangeDetail {
  address: string | null
  lotNumber: string | null
  community: string
  oldPrice: number
  newPrice: number
}

export interface RemovedListingDetail {
  address: string | null
  lotNumber: string | null
  community: string
}

export interface IncentiveDetail {
  address: string | null
  community: string
  incentives: string
}

export interface ChangeDetails {
  added: number
  priceChanges: number
  removed: number
  unchanged: number
  newListings: NewListingDetail[]
  priceChangeDetails: PriceChangeDetail[]
  removedListings: RemovedListingDetail[]
  newIncentives: IncentiveDetail[]
}

export async function detectAndApplyChanges(
  scrapedListings: ScrapedListing[],
  communityId: number,
  builderName?: string
): Promise<ChangeDetails> {
  // Get all non-removed listings in this community (active + sold + future).
  // Checking all statuses lets us:
  //  a) properly transition lots between states (future→active, active→sold, etc.)
  //  b) mark stale lots as "removed" even if they were never active
  const existing = await prisma.listing.findMany({
    where: { communityId, status: { not: "removed" } },
  })

  const community = await prisma.community.findUnique({ where: { id: communityId } })
  const communityName = community?.name ?? "Unknown"

  const existingByAddress = new Map(existing.map((l) => [normalizeAddress(l.address), l]))
  // Secondary lookup by lotNumber — catches cases where address changed between scrapes
  // (e.g. Lennar lot stored as "Lot 10041" then later gets a real street address)
  const existingByLotNumber = new Map(
    existing.filter((l) => l.lotNumber).map((l) => [l.lotNumber!, l])
  )

  // Removed listings also hold their lotNumber in the unique index.
  // When we need to assign that lotNumber to an active listing, we must first
  // clear it from the removed row — otherwise Prisma throws P2002.
  const removedListings = await prisma.listing.findMany({
    where: { communityId, status: "removed" },
    select: { id: true, lotNumber: true },
  })
  const removedByLotNumber = new Map(
    removedListings.filter((l) => l.lotNumber).map((l) => [l.lotNumber!, l.id])
  )
  const scrapedAddresses = new Set(scrapedListings.map((l) => normalizeAddress(l.address)))

  const stats: ChangeDetails = {
    added: 0,
    priceChanges: 0,
    removed: 0,
    unchanged: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    newIncentives: [],
  }
  const newListingIds: number[] = []

  // Process each scraped listing
  for (const scraped of scrapedListings) {
    const key = normalizeAddress(scraped.address)
    // Primary lookup by address; fallback to lotNumber if address changed
    const existing = existingByAddress.get(key)
      ?? (scraped.lotNumber ? existingByLotNumber.get(scraped.lotNumber) : undefined)

    if (!existing) {
      // If a *removed* listing is holding this lotNumber, clear it first so the
      // INSERT doesn't hit the unique constraint on (communityId, lotNumber).
      if (scraped.lotNumber) {
        const removedOwnerId = removedByLotNumber.get(scraped.lotNumber)
        if (removedOwnerId !== undefined) {
          await prisma.listing.update({ where: { id: removedOwnerId }, data: { lotNumber: null } })
          removedByLotNumber.delete(scraped.lotNumber)
        }
      }

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
          propertyType: scraped.propertyType,
          hoaFees: scraped.hoaFees,
          taxes: scraped.taxes,
          moveInDate: scraped.moveInDate,
          schools: scraped.schools,
          incentives: scraped.incentives,
          sourceUrl: scraped.sourceUrl,
          status: scraped.status ?? "active",
        },
        update: { status: scraped.status ?? "active" },
      })
      if (scraped.price) {
        const existingPrice = await prisma.priceHistory.findFirst({ where: { listingId: listing.id } })
        if (!existingPrice) {
          await prisma.priceHistory.create({
            data: { listingId: listing.id, price: scraped.price, changeType: "initial" },
          })
        }
      }
      newListingIds.push(listing.id)
      stats.added++
      stats.newListings.push({
        address: scraped.address,
        lotNumber: scraped.lotNumber ?? null,
        community: communityName,
        builder: builderName ?? "Unknown",
        price: scraped.price ?? null,
      })
      if (scraped.incentives) {
        stats.newIncentives.push({
          address: scraped.address,
          community: communityName,
          incentives: scraped.incentives,
        })
      }
    } else {
      // Existing listing — update status and check for price change

      // Guard: only update lotNumber if it won't collide with a different listing's unique key.
      // This can happen when two scrape entries swap lot numbers between runs — one listing is
      // found by address, but the scraped.lotNumber is already owned by a *different* DB row.
      const newLotNumber = scraped.lotNumber ?? existing.lotNumber
      const lotNumberOwner = newLotNumber ? existingByLotNumber.get(newLotNumber) : undefined
      const lotNumberConflicts =
        newLotNumber !== existing.lotNumber &&
        lotNumberOwner !== undefined &&
        lotNumberOwner.id !== existing.id

      // If a *removed* listing is holding this lotNumber, clear it first so our update can claim it.
      if (
        newLotNumber &&
        newLotNumber !== existing.lotNumber &&
        !lotNumberConflicts
      ) {
        const removedOwnerId = removedByLotNumber.get(newLotNumber)
        if (removedOwnerId !== undefined) {
          await prisma.listing.update({ where: { id: removedOwnerId }, data: { lotNumber: null } })
          removedByLotNumber.delete(newLotNumber)
        }
      }

      const updates: Record<string, unknown> = {
        status: scraped.status ?? existing.status,   // persist status transitions (future→active etc.)
        lotNumber: lotNumberConflicts ? existing.lotNumber : newLotNumber,
        floorPlan: scraped.floorPlan ?? existing.floorPlan,
        sqft: scraped.sqft ?? existing.sqft,
        beds: scraped.beds ?? existing.beds,
        baths: scraped.baths ?? existing.baths,
        garages: scraped.garages ?? existing.garages,
        floors: scraped.floors ?? existing.floors,
        pricePerSqft: scraped.pricePerSqft ?? existing.pricePerSqft,
        propertyType: scraped.propertyType ?? existing.propertyType,
        hoaFees: scraped.hoaFees ?? existing.hoaFees,
        taxes: scraped.taxes ?? existing.taxes,
        moveInDate: scraped.moveInDate ?? existing.moveInDate,
        schools: scraped.schools ?? existing.schools,
        incentives: scraped.incentives ?? existing.incentives,
        sourceUrl: scraped.sourceUrl ?? existing.sourceUrl,
      }

      // Track new or changed incentives on existing listings
      if (scraped.incentives && scraped.incentives !== existing.incentives) {
        stats.newIncentives.push({
          address: scraped.address,
          community: communityName,
          incentives: scraped.incentives,
        })
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

        // Send price change notification (fire-and-forget)
        if (changeType === "increase" || changeType === "decrease") {
          notifyPriceChange({
            listingId: existing.id,
            oldPrice: existing.currentPrice!,
            newPrice: scraped.price,
            changeType,
          }).catch(console.error)
        }

        stats.priceChanges++
        stats.priceChangeDetails.push({
          address: scraped.address,
          lotNumber: scraped.lotNumber ?? existing.lotNumber ?? null,
          community: communityName,
          oldPrice: existing.currentPrice!,
          newPrice: scraped.price,
        })
      } else {
        stats.unchanged++
      }

      await prisma.listing.update({ where: { id: existing.id }, data: updates })
    }
  }

  // Send new listing notifications for followed communities
  if (newListingIds.length > 0) {
    notifyNewListings({ communityId, newListingIds }).catch(console.error)
  }

  // Mark listings no longer in scrape as removed
  for (const [key, listing] of existingByAddress.entries()) {
    if (!scrapedAddresses.has(key)) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "removed", soldAt: new Date() },
      })
      stats.removed++
      stats.removedListings.push({
        address: listing.address,
        lotNumber: listing.lotNumber ?? null,
        community: communityName,
      })
    }
  }

  return stats
}

function normalizeAddress(address: string | null): string {
  return (address ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}
