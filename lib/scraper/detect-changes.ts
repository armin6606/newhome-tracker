import { prisma } from "@/lib/db"
import type { ScrapedListing } from "./toll-brothers"
import { notifyPriceChange, notifyNewListings } from "./notifications"
import { updateTable2 } from "@/lib/sheet-writer"
import { normalizeFloorPlanName } from "@/lib/plan-name"
import { normalizeListingLotKey, normalizeLotNumber } from "@/lib/lot-number"

// Matches placeholder lot numbers created by the ingest route (avail-N, sold-N, future-N)
const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/
const PLACEHOLDER_ADDRESS_RE = /^(?:lot|homesite|home\s*site|home-site|hs|site)\s*#?\s*[-:]?\s*[a-z0-9-]+$/i

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
    existing
      .map((l) => [normalizeListingLotKey(l.lotNumber, l.address), l] as const)
      .filter((entry): entry is [string, typeof existing[number]] => entry[0] !== null)
  )

  // Removed listings also hold their lotNumber in the unique index.
  // When we need to assign that lotNumber to an active listing, we must first
  // clear it from the removed row — otherwise Prisma throws P2002.
  const removedListings = await prisma.listing.findMany({
    where: { communityId, status: "removed" },
    select: { id: true, lotNumber: true },
  })
  const removedByLotNumber = new Map(
    removedListings
      .map((l) => [normalizeLotNumber(l.lotNumber), l.id] as const)
      .filter((entry): entry is [string, number] => entry[0] !== null)
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
  const processedExistingIds = new Set<number>()
  // Tracks net change to community.soldCount this run:
  //  +1 for each active→sold transition (explicit or disappearance-based)
  //  -1 for each sold→active reactivation
  let soldDelta = 0

  // Process each scraped listing
  for (const scraped of scrapedListings) {
    const normalizedFloorPlan = normalizeFloorPlanName(scraped.floorPlan, communityName)
    const key = normalizeAddress(scraped.address)
    const scrapedLotKey = normalizeListingLotKey(scraped.lotNumber, scraped.address)
    // Primary lookup by address; fallback to lotNumber if address changed
    const existing = existingByAddress.get(key)
      ?? (scrapedLotKey ? existingByLotNumber.get(scrapedLotKey) : undefined)

    if (!existing) {
      // If a *removed* listing is holding this lotNumber, clear it first so the
      // INSERT doesn't hit the unique constraint on (communityId, lotNumber).
      if (scrapedLotKey) {
        const removedOwnerId = removedByLotNumber.get(scrapedLotKey)
        if (removedOwnerId !== undefined) {
          await prisma.listing.update({ where: { id: removedOwnerId }, data: { lotNumber: null } })
          removedByLotNumber.delete(scrapedLotKey)
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
            floorPlan: normalizedFloorPlan,
            sqft: scraped.sqft,
            beds: scraped.beds,
            baths: scraped.baths,
            garages: scraped.garages,
            floors: scraped.floors,
            currentPrice: scraped.price,
            pricePerSqft: scraped.pricePerSqft,
            propertyType: scraped.propertyType,
            hoaFees: scraped.hoaFees,
            taxes: scraped.taxes != null ? String(scraped.taxes) : undefined,
            moveInDate: scraped.moveInDate,
            schools: scraped.schools,
            incentives: scraped.incentives,
            sourceUrl: scraped.sourceUrl,
            status: scraped.status ?? "for sale",
          },
          update: { status: scraped.status ?? "for sale" },
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
              floorPlan: normalizedFloorPlan,
              sqft: scraped.sqft,
              beds: scraped.beds,
              baths: scraped.baths,
              garages: scraped.garages,
              floors: scraped.floors,
              currentPrice: scraped.price,
              pricePerSqft: scraped.pricePerSqft,
              propertyType: scraped.propertyType,
              hoaFees: scraped.hoaFees,
              taxes: scraped.taxes != null ? String(scraped.taxes) : undefined,
              moveInDate: scraped.moveInDate,
              schools: scraped.schools,
              incentives: scraped.incentives,
              sourceUrl: scraped.sourceUrl,
              status: scraped.status ?? "for sale",
            },
            update: { status: scraped.status ?? "for sale" },
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

      // New real active listing — update the sheet's ForSale count.
      if (
        (scraped.status ?? "for sale") === "for sale" &&
        (!scraped.lotNumber || !PLACEHOLDER_RE.test(scraped.lotNumber))
      ) {
        if (builderName && builderName !== "Unknown") {
          updateTable2(builderName, communityName, { forSale: +1 })
            .catch((e) => console.error(`[sheet-writer] ${communityName} new listing:`, e))
        }
      }
    } else {
      processedExistingIds.add(existing.id)
      // Existing listing — update status and check for price change

      // Guard: only update lotNumber if it won't collide with a different listing's unique key.
      // This can happen when two scrape entries swap lot numbers between runs — one listing is
      // found by address, but the scraped.lotNumber is already owned by a *different* DB row.
      const newLotNumber = scraped.lotNumber ?? existing.lotNumber
      const newLotKey = normalizeLotNumber(newLotNumber)
      const existingLotKey = normalizeLotNumber(existing.lotNumber)
      const lotNumberOwner = newLotKey ? existingByLotNumber.get(newLotKey) : undefined
      const lotNumberConflicts =
        newLotKey !== existingLotKey &&
        lotNumberOwner !== undefined &&
        lotNumberOwner.id !== existing.id

      // If a *removed* listing is holding this lotNumber, clear it first so our update can claim it.
      if (
        newLotKey &&
        newLotKey !== existingLotKey &&
        !lotNumberConflicts
      ) {
        const removedOwnerId = removedByLotNumber.get(newLotKey)
        if (removedOwnerId !== undefined) {
          await prisma.listing.update({ where: { id: removedOwnerId }, data: { lotNumber: null } })
          removedByLotNumber.delete(newLotKey)
        }
      }

      const updates: Record<string, unknown> = {
        status: scraped.status ?? existing.status,   // persist status transitions (future→active etc.)
        lotNumber: lotNumberConflicts ? existing.lotNumber : newLotNumber,
        floorPlan: normalizedFloorPlan ?? existing.floorPlan,
        sqft: scraped.sqft ?? existing.sqft,
        beds: scraped.beds ?? existing.beds,
        baths: scraped.baths ?? existing.baths,
        garages: scraped.garages ?? existing.garages,
        floors: scraped.floors ?? existing.floors,
        pricePerSqft: scraped.pricePerSqft ?? existing.pricePerSqft,
        propertyType: scraped.propertyType ?? existing.propertyType,
        hoaFees: scraped.hoaFees ?? existing.hoaFees,
        taxes: scraped.taxes != null ? String(scraped.taxes) : existing.taxes,
        moveInDate: scraped.moveInDate ?? existing.moveInDate,
        schools: scraped.schools ?? existing.schools,
        incentives: scraped.incentives ?? existing.incentives,
        sourceUrl: scraped.sourceUrl ?? existing.sourceUrl,
      }

      const addressOwner = existingByAddress.get(key)
      const addressConflicts =
        key !== normalizeAddress(existing.address) &&
        addressOwner !== undefined &&
        addressOwner.id !== existing.id
      if (!addressConflicts && !isPlaceholderAddress(scraped.address)) {
        updates.address = scraped.address
      }

      // Track new or changed incentives on existing listings
      if (scraped.incentives && scraped.incentives !== existing.incentives) {
        stats.newIncentives.push({
          address: scraped.address,
          community: communityName,
          incentives: scraped.incentives,
        })
      }

      // Real listing went active → sold — update sheet counts.
      if (existing.status !== "sold" && scraped.status === "sold") {
        soldDelta++
        updates.soldAt = new Date()
        const table2Delta = existing.status === "for sale"
          ? { sold: +1, forSale: -1 }
          : { sold: +1 }
        updateTable2(builderName ?? "Unknown", communityName, table2Delta)
          .catch((e) => console.error(`[sheet-writer] ${communityName} active→sold:`, e))
      }

      // Reactivation: listing was sold/removed but scraper sees it as active again
      // Clear soldAt so the sales-pace chart is not skewed by the false sale.
      // Also flip one avail-N placeholder back to active so Table 2 stays in sync.
      if (
        (existing.status === "sold" || existing.status === "removed") &&
        scraped.status === "for sale"
      ) {
        updates.soldAt = null
        if (existing.status === "sold") soldDelta--   // undo the previous sold increment
        stats.reactivated++
        stats.reactivatedListings.push({
          address: scraped.address,
          lotNumber: scraped.lotNumber ?? existing.lotNumber ?? null,
          community: communityName,
        })
        console.log(`  [reactivated] ${communityName}: ${scraped.address} (was ${existing.status} → active)`)

        if (existing.status === "sold") {
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
          data: { listingId: existing.id, price: scraped.price, oldPrice: existing.currentPrice ?? null, changeType },
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

  // ── Handle listings no longer in scrape ────────────────────────────────────
  // Rule: only ACTIVE listings can "disappear". If they had a price → sold.
  //       Future/already-sold listings not in scrape are left unchanged.
  for (const [key, listing] of existingByAddress.entries()) {
    if (scrapedAddresses.has(key)) continue       // still present — skip
    if (processedExistingIds.has(listing.id)) continue // matched by lotNumber/address change
    if (listing.status !== "for sale") continue     // future/sold — leave as-is

    if (listing.currentPrice != null) {
      // Had a price → was for-sale → mark sold
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "sold", soldAt: new Date() },
      })
      soldDelta++
    } else {
      // Active but no price (edge case) → mark removed
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "removed", soldAt: null },
      })
    }
    stats.removed++
    stats.removedListings.push({
      address: listing.address,
      lotNumber: listing.lotNumber ?? null,
      community: communityName,
    })
  }

  // ── Update community.soldCount (net delta) and lastScrapedAt ──────────────
  await prisma.community.update({
    where: { id: communityId },
    data: {
      ...(soldDelta !== 0 ? { soldCount: { increment: soldDelta } } : {}),
      lastScrapedAt: new Date(),
    },
  })

  return stats
}

function normalizeAddress(address: string | null): string {
  return (address ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function isPlaceholderAddress(address: string | null | undefined): boolean {
  return !address || PLACEHOLDER_ADDRESS_RE.test(address.trim())
}
