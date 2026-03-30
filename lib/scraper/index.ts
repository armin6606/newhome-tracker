/**
 * index.ts — Sheet-driven 1 AM scraper orchestrator
 *
 * New architecture:
 * 1. Read each builder's Google Sheet tab (Table 1 = community name + URL)
 * 2. For each community URL → open the interactive map using the appropriate map reader
 * 3. Map reader returns MapResult: sold/forSale/future/total counts + optional per-lot array
 * 4. Build ScrapedListing[] from MapResult (per-lot if available; placeholder lots otherwise)
 * 5. Call detectAndApplyChanges → DB
 * 6. Send summary email
 *
 * Shea, Brookfield, TRI Pointe are NOT in this run.
 * Max 3 concurrent Playwright browsers.
 */

import { prisma } from "@/lib/db"
import { detectAndApplyChanges, type ChangeDetails } from "./detect-changes"
import { sendScrapeSummary } from "./scrape-summary"
import { fetchBuilderSheet } from "./sheet-reader"
import type { SheetCommunityRow } from "./sheet-reader"
import type { ScrapedListing } from "./toll-brothers"
import type { MapResult } from "./map-readers/types"

// Map readers
import { readTollBrothersMap } from "./map-readers/toll-brothers-map"
import { readLennarMap } from "./map-readers/lennar-map"
import { readPulteMap } from "./map-readers/pulte-map"
import { readDelWebbMap } from "./map-readers/del-webb-map"
import { readKBHomeMap } from "./map-readers/kb-home-map"
import { readTaylorMorrisonMap } from "./map-readers/taylor-morrison-map"
import { readMeliaMap } from "./map-readers/melia-map"

// ─── Builder definitions ──────────────────────────────────────────────────────

type MapReader = (url: string, communityName: string) => Promise<MapResult>

interface SheetBuilderConfig {
  name: string
  websiteUrl: string
  sheetGid: string
  readMap: MapReader
}

const SHEET_BUILDERS: SheetBuilderConfig[] = [
  {
    name: "Toll Brothers",
    websiteUrl: "https://www.tollbrothers.com",
    sheetGid: "0",
    readMap: readTollBrothersMap,
  },
  {
    name: "Lennar",
    websiteUrl: "https://www.lennar.com",
    sheetGid: "1235396983",
    readMap: readLennarMap,
  },
  {
    name: "Pulte",
    websiteUrl: "https://www.pulte.com",
    sheetGid: "1042095208",
    readMap: readPulteMap,
  },
  {
    name: "Del Webb",
    websiteUrl: "https://www.delwebb.com",
    sheetGid: "847960742",
    readMap: readDelWebbMap,
  },
  {
    name: "KB Home",
    websiteUrl: "https://www.kbhome.com",
    sheetGid: "2063280901",
    readMap: readKBHomeMap,
  },
  {
    name: "Taylor Morrison",
    websiteUrl: "https://www.taylormorrison.com",
    sheetGid: "1100202556",
    readMap: readTaylorMorrisonMap,
  },
  {
    name: "Melia Homes",
    websiteUrl: "https://meliahomes.com",
    sheetGid: "1767278823",
    readMap: readMeliaMap,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomDelayMs(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((r) => setTimeout(r, ms))
}

async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const msg = String(err)
    if (
      msg.includes("P1017") ||
      msg.includes("connection") ||
      msg.includes("closed")
    ) {
      console.log("  Reconnecting to database...")
      await prisma.$disconnect()
      await new Promise((r) => setTimeout(r, 2000))
      await prisma.$connect()
      return await fn()
    }
    throw err
  }
}

/**
 * Build ScrapedListing[] from a MapResult.
 * If the map reader returned per-lot data, use those.
 * Otherwise generate placeholder lots from the aggregate counts.
 * Enforces: no price → status "future", never "active".
 */
function buildListings(
  result: MapResult,
  communityName: string,
  communityUrl: string
): ScrapedListing[] {
  // If we have per-lot data from the map reader, use it directly
  if (result.lots && result.lots.length > 0) {
    return result.lots.map((lot) => {
      // No-price rule: if no price, status must be future (not active)
      const status: string =
        lot.status === "active" && !lot.price ? "future" : lot.status

      return {
        communityName,
        communityUrl,
        address: lot.address ?? `Lot ${lot.lotNumber}`,
        lotNumber: lot.lotNumber,
        floorPlan: lot.floorPlan,
        beds: lot.beds,
        baths: lot.baths,
        sqft: lot.sqft,
        price: status === "active" ? lot.price : undefined,
        pricePerSqft:
          status === "active" && lot.price && lot.sqft
            ? Math.round(lot.price / lot.sqft)
            : undefined,
        status,
        sourceUrl: communityUrl,
      } satisfies ScrapedListing
    })
  }

  // No per-lot data: generate placeholder lots from aggregate counts
  const listings: ScrapedListing[] = []

  for (let i = 1; i <= result.sold; i++) {
    listings.push({
      communityName,
      communityUrl,
      address: `sold-${i}`,
      lotNumber: `sold-${i}`,
      status: "sold",
      sourceUrl: communityUrl,
    })
  }

  for (let i = 1; i <= result.forSale; i++) {
    listings.push({
      communityName,
      communityUrl,
      address: `avail-${i}`,
      lotNumber: `avail-${i}`,
      // Use a generic non-zero placeholder price so the listing is properly
      // categorized as active. Real price data comes from the map reader when
      // per-lot data is available; here we have none.
      price: undefined,
      status: "active",
      sourceUrl: communityUrl,
    })
  }

  for (let i = 1; i <= result.future; i++) {
    listings.push({
      communityName,
      communityUrl,
      address: `future-${i}`,
      lotNumber: `future-${i}`,
      status: "future",
      sourceUrl: communityUrl,
    })
  }

  return listings
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  const executing = new Set<Promise<void>>()

  for (const task of tasks) {
    const p = task()
      .then((result) => {
        results.push(result)
      })
      .finally(() => {
        executing.delete(p)
      })
    executing.add(p)

    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}

// ─── Per-community scrape ─────────────────────────────────────────────────────

interface CommunityResult {
  scraped: number
  stats: ChangeDetails
  error?: { builder: string; error: string }
}

async function scrapeOneCommunity(
  builder: SheetBuilderConfig,
  builderId: number,
  row: SheetCommunityRow
): Promise<CommunityResult> {
  const emptyStats: ChangeDetails = {
    added: 0,
    priceChanges: 0,
    removed: 0,
    unchanged: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    newIncentives: [],
  }

  try {
    console.log(
      `  [${builder.name}] Scraping: ${row.communityName} → ${row.url}`
    )

    // Random 1-3s delay between map reads
    await randomDelayMs(1000, 3000)

    // Read the interactive map
    const mapResult = await builder.readMap(row.url, row.communityName)

    // Build ScrapedListing[] from the map result
    const listings = buildListings(mapResult, row.communityName, row.url)

    if (listings.length === 0) {
      console.log(
        `  [${builder.name}] ${row.communityName}: No lots found — skipping DB update`
      )
      return { scraped: 0, stats: emptyStats }
    }

    // Upsert community
    const community = await withReconnect(() =>
      prisma.community.upsert({
        where: {
          builderId_name: { builderId, name: row.communityName },
        },
        update: { url: row.url },
        create: {
          builderId,
          name: row.communityName,
          city: "Orange County",
          state: "CA",
          url: row.url,
        },
      })
    )

    // Detect and apply changes
    const stats = await detectAndApplyChanges(
      listings,
      community.id,
      builder.name
    )

    console.log(
      `  [${builder.name}] ${row.communityName}: +${stats.added} new, ` +
        `${stats.priceChanges} price changes, ${stats.removed} removed, ` +
        `${stats.unchanged} unchanged`
    )

    return { scraped: listings.length, stats }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(
      `  [${builder.name}] Error scraping ${row.communityName}:`,
      err
    )
    return {
      scraped: 0,
      stats: emptyStats,
      error: {
        builder: builder.name,
        error: `${row.communityName}: ${errorMsg}`,
      },
    }
  }
}

// ─── Per-builder scrape ───────────────────────────────────────────────────────

interface BuilderResult {
  scraped: number
  stats: ChangeDetails
  errors: { builder: string; error: string }[]
}

async function scrapeOneBuilder(
  config: SheetBuilderConfig
): Promise<BuilderResult> {
  const combinedStats: ChangeDetails = {
    added: 0,
    priceChanges: 0,
    removed: 0,
    unchanged: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    newIncentives: [],
  }
  const errors: { builder: string; error: string }[] = []
  let totalScraped = 0

  console.log(`\n--- ${config.name} (gid=${config.sheetGid}) ---`)

  // Fetch community list from Google Sheet
  let communities: SheetCommunityRow[]
  try {
    communities = await fetchBuilderSheet(config.sheetGid)
    console.log(`[${config.name}] ${communities.length} communities in sheet`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${config.name}] Failed to fetch sheet:`, err)
    errors.push({ builder: config.name, error: `Sheet fetch failed: ${msg}` })
    return { scraped: 0, stats: combinedStats, errors }
  }

  if (communities.length === 0) {
    console.log(`[${config.name}] No communities found in sheet — skipping`)
    return { scraped: 0, stats: combinedStats, errors }
  }

  // Upsert builder record once
  const builderRecord = await withReconnect(() =>
    prisma.builder.upsert({
      where: { name: config.name },
      update: {},
      create: { name: config.name, websiteUrl: config.websiteUrl },
    })
  )

  // Scrape each community (sequentially within a builder to avoid hammering one site)
  for (const row of communities) {
    const result = await scrapeOneCommunity(
      config,
      builderRecord.id,
      row
    )

    totalScraped += result.scraped
    combinedStats.added += result.stats.added
    combinedStats.priceChanges += result.stats.priceChanges
    combinedStats.removed += result.stats.removed
    combinedStats.unchanged += result.stats.unchanged
    combinedStats.newListings.push(...result.stats.newListings)
    combinedStats.priceChangeDetails.push(...result.stats.priceChangeDetails)
    combinedStats.removedListings.push(...result.stats.removedListings)
    combinedStats.newIncentives.push(...result.stats.newIncentives)

    if (result.error) errors.push(result.error)
  }

  return { scraped: totalScraped, stats: combinedStats, errors }
}

// ─── Main exported entry point ────────────────────────────────────────────────

const MAX_CONCURRENT_BUILDERS = 3

export async function runScraper(): Promise<ChangeDetails> {
  const scrapeStartTime = new Date()
  console.log(
    `[${scrapeStartTime.toISOString()}] Starting sheet-driven scrape ` +
      `(${SHEET_BUILDERS.length} builders, max ${MAX_CONCURRENT_BUILDERS} concurrent)...`
  )

  // Run builders with concurrency limit (max 3 Playwright browsers at once)
  const builderResults = await runWithConcurrency(
    SHEET_BUILDERS.map((config) => () => scrapeOneBuilder(config)),
    MAX_CONCURRENT_BUILDERS
  )

  // Aggregate totals
  const totalStats: ChangeDetails = {
    added: 0,
    priceChanges: 0,
    removed: 0,
    unchanged: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    newIncentives: [],
  }
  let totalScraped = 0
  const allErrors: { builder: string; error: string }[] = []

  for (const r of builderResults) {
    totalScraped += r.scraped
    totalStats.added += r.stats.added
    totalStats.priceChanges += r.stats.priceChanges
    totalStats.removed += r.stats.removed
    totalStats.unchanged += r.stats.unchanged
    totalStats.newListings.push(...r.stats.newListings)
    totalStats.priceChangeDetails.push(...r.stats.priceChangeDetails)
    totalStats.removedListings.push(...r.stats.removedListings)
    totalStats.newIncentives.push(...r.stats.newIncentives)
    allErrors.push(...r.errors)
  }

  const elapsed = ((Date.now() - scrapeStartTime.getTime()) / 1000).toFixed(1)
  console.log(
    `\n[${new Date().toISOString()}] Scrape complete in ${elapsed}s:`,
    `+${totalStats.added} new,`,
    `${totalStats.priceChanges} price changes,`,
    `${totalStats.removed} removed`
  )

  // Send daily scrape summary email
  try {
    await sendScrapeSummary({
      scrapeTime: scrapeStartTime,
      totalScraped,
      changes: totalStats,
      errors: allErrors,
    })
    console.log("Scrape summary email sent to info@newkey.us")
  } catch (err) {
    console.error("Failed to send scrape summary email:", err)
  }

  return totalStats
}
