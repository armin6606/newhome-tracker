import { prisma } from "@/lib/db"
import type { ScrapedListing } from "./toll-brothers"
import { notifyPriceChange, notifyNewListings } from "./notifications"
import { updateTable2 } from "@/lib/sheet-writer"

// Matches placeholder lot numbers created by the ingest route (avail-N, sold-N, future-N)
const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/

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

export interface ReactivatedListingDetail {
  address: string | null
  lotNumber: string | null
  community: string
}

export interface ChangeDetails {
  added: number
  priceChanges: number
  removed: number
  unchanged: number
  reactivated: number
  newListings: NewListingDetail[]
  priceChangeDetails: PriceChangeDetail[]
  removedListings: RemovedListingDetail[]
  reactivatedListings: ReactivatedListingDetail[]
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
    reactivated: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    reactivatedListings: [],
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
      let listing: { id: number }
      try {
        listing = await prisma.listing.upsert({
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
      } catch (err: unknown) {
        const code = (err as { code?: string }).code
        if (code === "P2002" && scraped.lotNumber) {
          // Lot number conflict — retry without lot number
          console.warn(`  [detect-changes] P2002 creating ${scraped.address} with lot ${scraped.lotNumber} — retrying without lot number`)
          listing = await prisma.listing.upsert({
            where: { communityId_address: { communityId, address: scraped.address } },
            create: {
              communityId,
              address: scraped.address,
              lotNumber: null,
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
        } else {
          throw err
        }
      }
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

      // New real active listing = a future lot was just released for sale.
      // 1. Update the sheet's ForSale +1 so its Future formula auto-decrements.
      // 2. Flip one future-N placeholder → active so the card reflects the new future count.
      // Only applies to genuinely new active listings (not placeholder ingests, not sold).
      if (
        (scraped.status ?? "active") === "active" &&
        (!scraped.lotNumber || !PLACEHOLDER_RE.test(scraped.lotNumber))
      ) {
        // Sheet update (fire-and-forget) — future formula auto-recalculates
        if (builderName && builderName !== "Unknown") {
          updateTable2(builderName, communityName, { forSale: +1 })
            .catch((e) => console.error(`[sheet-writer] ${communityName} new listing:`, e))
        }
        // DB: flip one future-N placeholder → active to mirror the formula result
        const futurePlaceholder = await prisma.listing.findFirst({
          where: { communityId, lotNumber: { startsWith: "future-" }, status: "future" },
        })
        if (futurePlaceholder) {
          await prisma.listing.update({
            where: { id: futurePlaceholder.id },
            data: { status: "active" },
          })
          console.log(`  [placeholder-sync] ${communityName}: flipped ${futurePlaceholder.lotNumber} → active (new listing released)`)
        }
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

      // Placeholder sync + sheet update: when a real listing goes active → sold
      // (explicit sold status only — "removed" could mean de-listed, not sold).
      if (existing.status === "active" && scraped.status === "sold") {
        // DB: flip one avail-N placeholder so Table 2 card counts stay accurate
        const availPlaceholder = await prisma.listing.findFirst({
          where: {
            communityId,
            lotNumber: { startsWith: "avail-" },
            status: "active",
          },
        })
        if (availPlaceholder) {
          await prisma.listing.update({
            where: { id: availPlaceholder.id },
            data: { status: "sold", soldAt: new Date() },
          })
          console.log(`  [placeholder-sync] ${communityName}: flipped ${availPlaceholder.lotNumber} → sold`)
        }
        // Sheet: sold +1, forSale -1  (future column is never touched)
        updateTable2(builderName ?? "Unknown", communityName, { sold: +1, forSale: -1 })
          .catch((e) => console.error(`[sheet-writer] ${communityName} active→sold:`, e))
      }

      // Reactivation: listing was sold/removed but scraper sees it as active again
      // Clear soldAt so the sales-pace chart is not skewed by the false sale.
      // Also flip one avail-N placeholder back to active so Table 2 stays in sync.
      if (
        (existing.status === "sold" || existing.status === "removed") &&
        scraped.status === "active"
      ) {
        updates.soldAt = null
        stats.reactivated++
        stats.reactivatedListings.push({
          address: scraped.address,
          lotNumber: scraped.lotNumber ?? existing.lotNumber ?? null,
          community: communityName,
        })
        console.log(`  [reactivated] ${communityName}: ${scraped.address} (was ${existing.status} → active)`)

        // DB: flip one avail-N placeholder back to active
        if (existing.status === "sold") {
          const soldAvailPlaceholder = await prisma.listing.findFirst({
            where: {
              communityId,
              lotNumber: { startsWith: "avail-" },
              status: "sold",
            },
          })
          if (soldAvailPlaceholder) {
            await prisma.listing.update({
              where: { id: soldAvailPlaceholder.id },
              data: { status: "active", soldAt: null },
            })
            console.log(`  [placeholder-sync] ${communityName}: flipped ${soldAvailPlaceholder.lotNumber} back → active`)
          }
          // Sheet: sold -1, forSale +1  (future column is never touched)
          updateTable2(builderName ?? "Unknown", communityName, { sold: -1, forSale: +1 })
            .catch((e) => console.error(`[sheet-writer] ${communityName} reactivation:`, e))
        }
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

      try {
        await prisma.listing.update({ where: { id: existing.id }, data: updates })
      } catch (err: unknown) {
        // P2002 = unique constraint violation on (communityId, lotNumber).
        // Clear the conflicting lot number and retry — this happens when two scrape
        // entries swap lot numbers between runs.
        const code = (err as { code?: string }).code
        if (code === "P2002") {
          console.warn(`  [detect-changes] P2002 on lot ${updates.lotNumber as string} — clearing lot number and retrying`)
          await prisma.listing.update({ where: { id: existing.id }, data: { ...updates, lotNumber: null } })
        } else {
          throw err
        }
      }
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
