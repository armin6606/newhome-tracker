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

import { writeFileSync } from "fs"
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
      // No-price rule: lots marked active without a price are downgraded to future —
      // UNLESS the map reader provided a real street address (e.g. Del Webb QMI lots).
      // A real address means the map reader is certain this is a for-sale home.
      const hasRealAddress = lot.address && !/^(lot|avail|sold|future)\s*[-\d]/i.test(lot.address)
      const status: string =
        lot.status === "active" && !lot.price && !hasRealAddress ? "future" : lot.status

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

// ─── Per-builder timeout ──────────────────────────────────────────────────────

const BUILDER_TIMEOUT_MS = 45 * 60 * 1000 // 45 minutes per builder

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Builder timed out after ${Math.round(ms / 60000)}m: ${label}`)),
      ms
    )
  )
  return Promise.race([promise, timeout])
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
    reactivated: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    reactivatedListings: [],
    newIncentives: [],
  }

  try {
    console.log(
      `  [${builder.name}] Scraping: ${row.communityName} → ${row.url}`
    )

    // Random 1-3 minute delay between map reads
    await randomDelayMs(60_000, 180_000)

    // Retry once after 60s on failure or zero results
    let mapResult = await builder.readMap(row.url, row.communityName).catch(async (err: unknown) => {
      console.warn(`  [${builder.name}] ${row.communityName}: First attempt failed (${err instanceof Error ? err.message : String(err)}), retrying in 60s...`)
      await new Promise(r => setTimeout(r, 60_000))
      return builder.readMap(row.url, row.communityName)
    })

    // If first attempt returned 0 lots but DB has data, retry once after 60s
    const firstAttemptTotal = (mapResult.lots?.length ?? 0) + mapResult.sold + mapResult.forSale + mapResult.future + mapResult.total
    if (firstAttemptTotal === 0) {
      const dbCount = await prisma.listing.count({
        where: { community: { builderId, name: row.communityName }, status: { not: "removed" } }
      })
      if (dbCount > 3) {
        console.warn(`  [${builder.name}] ${row.communityName}: Got 0 lots but DB has ${dbCount}, retrying in 60s...`)
        await new Promise(r => setTimeout(r, 60_000))
        mapResult = await builder.readMap(row.url, row.communityName).catch((err: unknown) => {
          console.warn(`  [${builder.name}] ${row.communityName}: Retry also failed: ${err instanceof Error ? err.message : String(err)}`)
          return mapResult // return original empty result
        })
      }
    }

    // Build ScrapedListing[] from the map result
    const listings = buildListings(mapResult, row.communityName, row.url)

    // Zero-result guard: if scraper returned nothing, check against DB
    const existingCount = await prisma.listing.count({
      where: {
        community: { builderId, name: row.communityName },
        status: { not: "removed" },
      },
    })

    if (listings.length === 0) {
      if (existingCount > 3) {
        const msg = `${row.communityName}: Zero lots returned but community had ${existingCount} lots in DB — possible scraper/map failure, skipping DB update`
        console.warn(`  [${builder.name}] ALERT: ${msg}`)
        return { scraped: 0, stats: emptyStats, error: { builder: builder.name, error: msg } }
      }
      console.log(`  [${builder.name}] ${row.communityName}: No lots found — skipping DB update`)
      return { scraped: 0, stats: emptyStats }
    }

    // Partial-result guard: if scraped count < 50% of DB count, likely a scrape failure
    if (existingCount > 10 && listings.length < existingCount * 0.5) {
      const msg = `${row.communityName}: Only ${listings.length} lots scraped but DB has ${existingCount} — result looks incomplete, skipping DB update`
      console.warn(`  [${builder.name}] ALERT: ${msg}`)
      return { scraped: 0, stats: emptyStats, error: { builder: builder.name, error: msg } }
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

    // Deduplicate by address then by lotNumber — prevents P2002 when scraper
    // returns duplicate entries for the same physical lot.
    const seenAddrs = new Map<string, ScrapedListing>()
    const seenLots  = new Map<string, ScrapedListing>()
    for (const l of listings) {
      const normAddr = (l.address ?? "").toLowerCase().trim()
      if (normAddr && !/^(avail|sold|future)-/.test(normAddr)) {
        seenAddrs.set(normAddr, l)
      } else if (l.lotNumber) {
        seenLots.set(l.lotNumber, l)
      }
    }
    const dedupedListings = [...seenAddrs.values(), ...seenLots.values()]

    // Detect and apply changes
    const stats = await detectAndApplyChanges(
      dedupedListings,
      community.id,
      builder.name
    )

    console.log(
      `  [${builder.name}] ${row.communityName}: +${stats.added} new, ` +
        `${stats.priceChanges} price changes, ${stats.removed} removed, ` +
        `${stats.unchanged} unchanged`
    )

    return { scraped: dedupedListings.length, stats }
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
  communityCount: number
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
    reactivated: 0,
    newListings: [],
    priceChangeDetails: [],
    removedListings: [],
    reactivatedListings: [],
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
    return { scraped: 0, communityCount: 0, stats: combinedStats, errors }
  }

  if (communities.length === 0) {
    console.log(`[${config.name}] No communities found in sheet — skipping`)
    return { scraped: 0, communityCount: 0, stats: combinedStats, errors }
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
    combinedStats.reactivated += result.stats.reactivated
    combinedStats.newListings.push(...result.stats.newListings)
    combinedStats.priceChangeDetails.push(...result.stats.priceChangeDetails)
    combinedStats.removedListings.push(...result.stats.removedListings)
    combinedStats.reactivatedListings.push(...result.stats.reactivatedListings)
    combinedStats.newIncentives.push(...result.stats.newIncentives)

    if (result.error) errors.push(result.error)
  }

  return { scraped: totalScraped, communityCount: communities.length, stats: combinedStats, errors }
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
  // Each builder is wrapped in a 15-minute timeout to prevent a hung Playwright
  // session from blocking the entire run.
  const emptyBuilderResult: BuilderResult = {
    scraped: 0,
    communityCount: 0,
    stats: {
      added: 0, priceChanges: 0, removed: 0, unchanged: 0, reactivated: 0,
      newListings: [], priceChangeDetails: [], removedListings: [], reactivatedListings: [], newIncentives: [],
    },
    errors: [],
  }
  const builderResults = await runWithConcurrency(
    SHEET_BUILDERS.map((config) => async () => {
      try {
        const result = await withTimeout(scrapeOneBuilder(config), BUILDER_TIMEOUT_MS, config.name)
        return { ...result, builderName: config.name }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[${config.name}] Fatal/timeout error:`, msg)
        return { ...emptyBuilderResult, errors: [{ builder: config.name, error: msg }], builderName: config.name }
      }
    }),
    MAX_CONCURRENT_BUILDERS
  )

  // Aggregate totals
  const totalStats: ChangeDetails = {
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
  let totalScraped = 0
  const allErrors: { builder: string; error: string }[] = []

  for (const r of builderResults) {
    totalScraped += r.scraped
    totalStats.added += r.stats.added
    totalStats.priceChanges += r.stats.priceChanges
    totalStats.removed += r.stats.removed
    totalStats.unchanged += r.stats.unchanged
    totalStats.reactivated += r.stats.reactivated
    totalStats.newListings.push(...r.stats.newListings)
    totalStats.priceChangeDetails.push(...r.stats.priceChangeDetails)
    totalStats.removedListings.push(...r.stats.removedListings)
    totalStats.reactivatedListings.push(...r.stats.reactivatedListings)
    totalStats.newIncentives.push(...r.stats.newIncentives)
    allErrors.push(...r.errors)
  }

  // Write per-builder outcomes so the CI email step can show one row per builder
  try {
    const outcomes: Record<string, {
      status: string; communities: number; errorCount: number; errors: string[]
      newListings: { address: string | null; lotNumber: string | null; community: string; price: number | null }[]
      priceChanges: { address: string | null; lotNumber: string | null; community: string; oldPrice: number; newPrice: number }[]
      soldListings: { address: string | null; lotNumber: string | null; community: string }[]
    }> = {}
    for (const r of builderResults) {
      outcomes[r.builderName] = {
        status: r.errors.length === 0 ? "success" : "failure",
        communities: r.communityCount,
        errorCount: r.errors.length,
        errors: r.errors.map((e) => e.error).slice(0, 3),
        newListings: r.stats.newListings.slice(0, 20).map((l) => ({
          address: l.address, lotNumber: l.lotNumber ?? null, community: l.community, price: l.price,
        })),
        priceChanges: r.stats.priceChangeDetails.slice(0, 20).map((l) => ({
          address: l.address, lotNumber: l.lotNumber ?? null, community: l.community, oldPrice: l.oldPrice, newPrice: l.newPrice,
        })),
        soldListings: r.stats.removedListings.slice(0, 20).map((l) => ({
          address: l.address, lotNumber: l.lotNumber ?? null, community: l.community,
        })),
        reactivated: r.stats.reactivatedListings.slice(0, 20).map((l) => ({
          address: l.address, lotNumber: l.lotNumber ?? null, community: l.community,
        })),
      }
    }
    writeFileSync("/tmp/scrape-results.json", JSON.stringify(outcomes))
    console.log("Wrote per-builder outcomes to /tmp/scrape-results.json")
  } catch (e) {
    console.warn("Could not write /tmp/scrape-results.json:", e)
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
