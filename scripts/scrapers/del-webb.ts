/**
 * del-webb.ts
 * Standalone Del Webb scraper.
 * Run: npx tsx scripts/scrapers/del-webb.ts
 */

import { PrismaClient } from "@prisma/client"
import { writeFileSync, readFileSync, existsSync } from "fs"
import { notifyPriceChange, notifyNewListings } from "../../lib/scraper/notifications"
import { updateTable2 } from "../../lib/sheet-writer"
import { readDelWebbMap } from "../../lib/scraper/map-readers/del-webb-map"
import type { MapResult } from "../../lib/scraper/map-readers/types"

const prisma = new PrismaClient()

const BUILDER_NAME = "Del Webb"
const SHEET_GID = "847960742"
const WEBSITE_URL = "https://www.delwebb.com"
const RESULTS_FILE = "/tmp/scrape-results.json"

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ScrapedListing {
  communityName: string
  communityUrl: string
  address: string
  lotNumber?: string | null
  floorPlan?: string | null
  sqft?: number
  beds?: number
  baths?: number
  garages?: number
  floors?: number
  price?: number
  pricePerSqft?: number
  propertyType?: string
  hoaFees?: number
  taxes?: number | string
  moveInDate?: string
  schools?: string
  incentives?: string
  sourceUrl: string
  status?: string
}

interface ChangeDetails {
  added: number
  priceChanges: number
  removed: number
  unchanged: number
  reactivated: number
  newListings: { address: string | null; lotNumber: string | null; community: string; price: number | null }[]
  priceChangeDetails: { address: string | null; lotNumber: string | null; community: string; oldPrice: number; newPrice: number }[]
  removedListings: { address: string | null; lotNumber: string | null; community: string }[]
  reactivatedListings: { address: string | null; lotNumber: string | null; community: string }[]
  newIncentives: { address: string | null; community: string; incentives: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/

function normalizeAddress(address: string | null): string {
  return (address ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function randomDelayMs(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((r) => setTimeout(r, ms))
}

async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() }
  catch (err: unknown) {
    const msg = String(err)
    if (msg.includes("P1017") || msg.includes("connection") || msg.includes("closed")) {
      await prisma.$disconnect()
      await new Promise(r => setTimeout(r, 2000))
      await prisma.$connect()
      return await fn()
    }
    throw err
  }
}

// ── Sheet reader ──────────────────────────────────────────────────────────────

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

interface SheetCommunityRow { communityName: string; url: string; sold: number; forSale: number; future: number; total: number }

function parseCsvLine(line: string): string[] {
  const cols: string[] = []; let current = ""; let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = "" }
    else { current += ch }
  }
  cols.push(current.trim()); return cols
}

function parseNum(val: string | undefined): number {
  if (!val) return 0
  const n = parseInt(val.replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? 0 : n
}

async function fetchBuilderSheet(gid: string): Promise<SheetCommunityRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to fetch sheet gid=${gid}: HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const dataRows = lines.slice(2)
  const results: SheetCommunityRow[] = []
  for (const line of dataRows) {
    const cols = parseCsvLine(line)
    const communityName = cols[0]?.trim() || ""
    const url = cols[1]?.trim() || ""
    if (!communityName || !url || !url.startsWith("http")) continue
    results.push({ communityName, url, sold: parseNum(cols[4]), forSale: parseNum(cols[5]), future: parseNum(cols[6]), total: parseNum(cols[7]) })
  }
  return results
}

// ── buildListings ─────────────────────────────────────────────────────────────

function buildListings(result: MapResult, communityName: string, communityUrl: string): ScrapedListing[] {
  if (result.lots && result.lots.length > 0) {
    return result.lots.map(lot => {
      const hasRealAddress = lot.address && !/^(lot|avail|sold|future)\s*[-\d]/i.test(lot.address)
      const status: string = lot.status === "for sale" && !lot.price && !hasRealAddress ? "future" : lot.status
      return {
        communityName, communityUrl,
        address: lot.address ?? `Lot ${lot.lotNumber}`,
        lotNumber: lot.lotNumber, floorPlan: lot.floorPlan,
        beds: lot.beds, baths: lot.baths, sqft: lot.sqft,
        price: status === "for sale" ? lot.price : undefined,
        pricePerSqft: status === "for sale" && lot.price && lot.sqft ? Math.round(lot.price / lot.sqft) : undefined,
        status, sourceUrl: communityUrl,
      } as ScrapedListing
    })
  }
  return []
}

// ── detectAndApplyChanges ─────────────────────────────────────────────────────

async function detectAndApplyChanges(
  scrapedListings: ScrapedListing[],
  communityId: number,
  builderName?: string
): Promise<ChangeDetails> {
  const existing = await prisma.listing.findMany({
    where: { communityId, status: { not: "removed" } },
  })

  const community = await prisma.community.findUnique({ where: { id: communityId } })
  const communityName = community?.name ?? "Unknown"

  const existingByAddress = new Map(existing.map((l) => [normalizeAddress(l.address), l]))
  const existingByLotNumber = new Map(
    existing.filter((l) => l.lotNumber).map((l) => [l.lotNumber!, l])
  )

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
  let soldDelta = 0

  for (const scraped of scrapedListings) {
    const key = normalizeAddress(scraped.address)
    const existing = existingByAddress.get(key)
      ?? (scraped.lotNumber ? existingByLotNumber.get(scraped.lotNumber) : undefined)

    if (!existing) {
      if (scraped.lotNumber) {
        const removedOwnerId = removedByLotNumber.get(scraped.lotNumber)
        if (removedOwnerId !== undefined) {
          await prisma.listing.update({ where: { id: removedOwnerId }, data: { lotNumber: null } })
          removedByLotNumber.delete(scraped.lotNumber)
        }
      }

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
            status: scraped.status ?? "for sale",
          },
          update: { status: scraped.status ?? "for sale" },
        })
      } catch (err: unknown) {
        const code = (err as { code?: string }).code
        if (code === "P2002" && scraped.lotNumber) {
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
        price: scraped.price ?? null,
      })
      if (scraped.incentives) {
        stats.newIncentives.push({
          address: scraped.address,
          community: communityName,
          incentives: scraped.incentives,
        })
      }

      if (
        (scraped.status ?? "for sale") === "for sale" &&
        (!scraped.lotNumber || !PLACEHOLDER_RE.test(scraped.lotNumber))
      ) {
        if (builderName && builderName !== "Unknown") {
          updateTable2(builderName, communityName, { forSale: +1 })
            .catch((e) => console.error(`[sheet-writer] ${communityName} new listing:`, e))
        }
        const futurePlaceholder = await prisma.listing.findFirst({
          where: { communityId, lotNumber: { startsWith: "future-" }, status: "future" },
        })
        if (futurePlaceholder) {
          await prisma.listing.update({
            where: { id: futurePlaceholder.id },
            data: { status: "for sale" },
          })
          console.log(`  [placeholder-sync] ${communityName}: flipped ${futurePlaceholder.lotNumber} → active (new listing released)`)
        }
      }
    } else {
      const newLotNumber = scraped.lotNumber ?? existing.lotNumber
      const lotNumberOwner = newLotNumber ? existingByLotNumber.get(newLotNumber) : undefined
      const lotNumberConflicts =
        newLotNumber !== existing.lotNumber &&
        lotNumberOwner !== undefined &&
        lotNumberOwner.id !== existing.id

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
        status: scraped.status ?? existing.status,
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

      if (scraped.incentives && scraped.incentives !== existing.incentives) {
        stats.newIncentives.push({
          address: scraped.address,
          community: communityName,
          incentives: scraped.incentives,
        })
      }

      if (existing.status === "for sale" && scraped.status === "sold") {
        updates.soldAt = new Date()
        soldDelta++
        const availPlaceholder = await prisma.listing.findFirst({
          where: {
            communityId,
            lotNumber: { startsWith: "avail-" },
            status: "for sale",
          },
        })
        if (availPlaceholder) {
          await prisma.listing.update({
            where: { id: availPlaceholder.id },
            data: { status: "sold", soldAt: new Date() },
          })
          console.log(`  [placeholder-sync] ${communityName}: flipped ${availPlaceholder.lotNumber} → sold`)
        }
        updateTable2(builderName ?? "Unknown", communityName, { sold: +1, forSale: -1 })
          .catch((e) => console.error(`[sheet-writer] ${communityName} active→sold:`, e))
      }

      if (
        (existing.status === "sold" || existing.status === "removed") &&
        scraped.status === "for sale"
      ) {
        updates.soldAt = null
        if (existing.status === "sold") soldDelta--
        stats.reactivated++
        stats.reactivatedListings.push({
          address: scraped.address,
          lotNumber: scraped.lotNumber ?? existing.lotNumber ?? null,
          community: communityName,
        })
        console.log(`  [reactivated] ${communityName}: ${scraped.address} (was ${existing.status} → active)`)

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
              data: { status: "for sale", soldAt: null },
            })
            console.log(`  [placeholder-sync] ${communityName}: flipped ${soldAvailPlaceholder.lotNumber} back → active`)
          }
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

  if (newListingIds.length > 0) {
    notifyNewListings({ communityId, newListingIds }).catch(console.error)
  }

  for (const [key, listing] of existingByAddress.entries()) {
    if (scrapedAddresses.has(key)) continue
    if (listing.status !== "for sale") continue

    if (listing.currentPrice != null) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "sold", soldAt: new Date() },
      })
      soldDelta++
    } else {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: "removed", soldAt: new Date() },
      })
    }
    stats.removed++
    stats.removedListings.push({
      address: listing.address,
      lotNumber: listing.lotNumber ?? null,
      community: communityName,
    })
  }

  await prisma.community.update({
    where: { id: communityId },
    data: {
      ...(soldDelta !== 0 ? { soldCount: { increment: soldDelta } } : {}),
      lastScrapedAt: new Date(),
    },
  })

  return stats
}

// ── scrapeOneCommunity ────────────────────────────────────────────────────────

async function scrapeOneCommunity(builderId: number, row: SheetCommunityRow): Promise<{ scraped: number; stats: ChangeDetails; error?: { builder: string; error: string } }> {
  const emptyStats: ChangeDetails = { added: 0, priceChanges: 0, removed: 0, unchanged: 0, reactivated: 0, newListings: [], priceChangeDetails: [], removedListings: [], reactivatedListings: [], newIncentives: [] }
  try {
    console.log(`  [${BUILDER_NAME}] Scraping: ${row.communityName} → ${row.url}`)
    await randomDelayMs(10_000, 30_000)

    let mapResult = await readDelWebbMap(row.url, row.communityName).catch(async (err: unknown) => {
      console.warn(`  [${BUILDER_NAME}] ${row.communityName}: First attempt failed, retrying in 60s...`)
      await new Promise(r => setTimeout(r, 60_000))
      return readDelWebbMap(row.url, row.communityName)
    })

    const firstAttemptTotal = (mapResult.lots?.length ?? 0) + mapResult.sold + mapResult.forSale + mapResult.future + mapResult.total
    if (firstAttemptTotal === 0) {
      const dbCount = await prisma.listing.count({ where: { community: { builderId, name: row.communityName }, status: { not: "removed" } } })
      if (dbCount > 3) {
        console.warn(`  [${BUILDER_NAME}] ${row.communityName}: Got 0 lots but DB has ${dbCount}, retrying in 60s...`)
        await new Promise(r => setTimeout(r, 60_000))
        mapResult = await readDelWebbMap(row.url, row.communityName).catch(() => mapResult)
      }
    }

    const listings = buildListings(mapResult, row.communityName, row.url)
    const existingCount = await prisma.listing.count({ where: { community: { builderId, name: row.communityName }, status: { not: "removed" } } })

    if (listings.length === 0) {
      if (existingCount > 3) {
        const msg = `${row.communityName}: Zero lots returned but community had ${existingCount} lots in DB — skipping`
        console.warn(`  [${BUILDER_NAME}] ALERT: ${msg}`)
        return { scraped: 0, stats: emptyStats, error: { builder: BUILDER_NAME, error: msg } }
      }
      return { scraped: 0, stats: emptyStats }
    }

    if (existingCount > 10 && listings.length < existingCount * 0.5) {
      const msg = `${row.communityName}: Only ${listings.length} lots but DB has ${existingCount} — looks incomplete, skipping`
      console.warn(`  [${BUILDER_NAME}] ALERT: ${msg}`)
      return { scraped: 0, stats: emptyStats, error: { builder: BUILDER_NAME, error: msg } }
    }

    const community = await withReconnect(() =>
      prisma.community.upsert({
        where: { builderId_name: { builderId, name: row.communityName } },
        update: { url: row.url },
        create: { builderId, name: row.communityName, city: "Orange County", state: "CA", url: row.url },
      })
    )

    const seenAddrs = new Map<string, ScrapedListing>()
    const seenLots  = new Map<string, ScrapedListing>()
    for (const l of listings) {
      const normAddr = (l.address ?? "").toLowerCase().trim()
      if (normAddr && !/^(avail|sold|future)-/.test(normAddr)) seenAddrs.set(normAddr, l)
      else if (l.lotNumber) seenLots.set(l.lotNumber, l)
    }
    const dedupedListings = [...seenAddrs.values(), ...seenLots.values()]

    const stats = await detectAndApplyChanges(dedupedListings, community.id, BUILDER_NAME)
    console.log(`  [${BUILDER_NAME}] ${row.communityName}: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
    return { scraped: dedupedListings.length, stats }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`  [${BUILDER_NAME}] Error scraping ${row.communityName}:`, err)
    return { scraped: 0, stats: emptyStats, error: { builder: BUILDER_NAME, error: `${row.communityName}: ${errorMsg}` } }
  }
}

// ── appendResults ─────────────────────────────────────────────────────────────

function appendResults(communities: number, errors: string[], startedAt: string, finishedAt: string) {
  try {
    let existing: Record<string, unknown> = {}
    if (existsSync(RESULTS_FILE)) { try { existing = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) } catch {} }
    existing[BUILDER_NAME] = { status: errors.length === 0 ? "success" : "failure", communities, errorCount: errors.length, errors: errors.slice(0, 3), startedAt, finishedAt }
    writeFileSync(RESULTS_FILE, JSON.stringify(existing))
  } catch (e) { console.warn("Could not write results file:", e) }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString()
  console.log("=".repeat(60))
  console.log(`${BUILDER_NAME} Scraper — ${startedAt}`)
  console.log("=".repeat(60))

  const errors: string[] = []
  let totalScraped = 0
  let communityCount = 0

  try {
    const communities = await fetchBuilderSheet(SHEET_GID)
    communityCount = communities.length
    console.log(`[${BUILDER_NAME}] ${communityCount} communities in sheet`)

    if (communityCount === 0) {
      console.log(`[${BUILDER_NAME}] No communities found — exiting`)
      appendResults(0, ["No communities found in sheet"], startedAt, new Date().toISOString())
      return
    }

    const builderRecord = await withReconnect(() =>
      prisma.builder.upsert({
        where: { name: BUILDER_NAME },
        update: {},
        create: { name: BUILDER_NAME, websiteUrl: WEBSITE_URL },
      })
    )

    for (const row of communities) {
      const result = await scrapeOneCommunity(builderRecord.id, row)
      totalScraped += result.scraped
      if (result.error) errors.push(result.error.error)
    }

    console.log(`\n[${BUILDER_NAME}] Done — ${totalScraped} listings processed, ${errors.length} errors`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${BUILDER_NAME}] Fatal error:`, err)
    errors.push(`Fatal: ${msg}`)
  } finally {
    appendResults(communityCount, errors, startedAt, new Date().toISOString())
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error("Unhandled:", err); process.exit(1) })
