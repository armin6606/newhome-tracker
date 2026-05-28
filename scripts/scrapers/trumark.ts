/**
 * trumark.ts
 * Standalone Trumark scraper.
 * Run: npx tsx scripts/scrapers/trumark.ts
 */

import { PrismaClient } from "@prisma/client"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { detectAndApplyChanges, type ChangeDetails } from "../../lib/scraper/detect-changes"
import type { ScrapedListing } from "../../lib/scraper/toll-brothers"
import { readTrumarkMap, trumarkCityFromUrl } from "../../lib/scraper/map-readers/trumark-map"
import type { MapResult } from "../../lib/scraper/map-readers/types"

const prisma = new PrismaClient()

const BUILDER_NAME = "Trumark"
const SHEET_TAB = "Trumark"
const WEBSITE_URL = "https://trumarkhomes.com"
const RESULTS_FILE = "/tmp/scrape-results.json"
const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

interface SheetCommunityRow {
  communityName: string
  url: string
  sold: number
  forSale: number
  future: number
  total: number
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ""
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === "," && !inQuotes) { cols.push(current.trim()); current = "" }
    else current += ch
  }
  cols.push(current.trim())
  return cols.map((c) => c.replace(/^"|"$/g, ""))
}

function parseNum(val: string | undefined): number {
  if (!val) return 0
  const n = parseInt(val.replace(/[^0-9]/g, ""), 10)
  return Number.isFinite(n) ? n : 0
}

function cleanCommunityUrl(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.delete("utm_source")
    u.searchParams.delete("utm_medium")
    u.searchParams.delete("utm_campaign")
    u.searchParams.delete("gclid")
    u.searchParams.delete("gbraid")
    return u.toString()
  } catch {
    return url.trim()
  }
}

function randomDelayMs(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() }
  catch (err: unknown) {
    const msg = String(err)
    if (msg.includes("P1017") || msg.includes("connection") || msg.includes("closed")) {
      await prisma.$disconnect()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await prisma.$connect()
      return await fn()
    }
    throw err
  }
}

async function fetchBuilderSheet(): Promise<SheetCommunityRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`
  const res = await fetch(url, { cache: "no-store", redirect: "follow" })
  if (!res.ok) throw new Error(`Failed to fetch sheet tab "${SHEET_TAB}": HTTP ${res.status}`)
  const text = await res.text()
  const rows = text.split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine)
  const results: SheetCommunityRow[] = []

  for (const cols of rows) {
    const communityName = (cols[3] || cols[0] || "").trim()
    const rawUrl = (cols[1] || "").trim()
    if (!communityName || communityName.toLowerCase() === "community") continue
    if (!rawUrl.startsWith("http")) continue

    results.push({
      communityName,
      url: cleanCommunityUrl(rawUrl),
      sold: parseNum(cols[4]),
      forSale: parseNum(cols[5]),
      future: parseNum(cols[6]),
      total: parseNum(cols[7]),
    })
  }

  return results
}

function buildListings(result: MapResult, communityName: string, communityUrl: string): ScrapedListing[] {
  return (result.lots ?? []).map((lot) => {
    const status = lot.status === "for sale" && !lot.price ? "future" : lot.status
    const price = status === "for sale" ? lot.price : undefined
    return {
      communityName,
      communityUrl,
      city: trumarkCityFromUrl(communityUrl),
      address: lot.address ?? `Lot ${lot.lotNumber}`,
      lotNumber: lot.lotNumber,
      floorPlan: lot.floorPlan,
      sqft: lot.sqft,
      beds: lot.beds,
      baths: lot.baths,
      garages: lot.garages,
      floors: lot.floors,
      propertyType: lot.propertyType,
      hoaFees: lot.hoaFees,
      moveInDate: lot.moveInDate,
      price,
      pricePerSqft: price && lot.sqft ? Math.round(price / lot.sqft) : undefined,
      sourceUrl: lot.sourceUrl ?? communityUrl,
      status,
    }
  })
}

async function scrapeOneCommunity(
  builderId: number,
  row: SheetCommunityRow
): Promise<{ scraped: number; stats: ChangeDetails; error?: { builder: string; error: string } }> {
  const emptyStats: ChangeDetails = {
    added: 0, priceChanges: 0, removed: 0, unchanged: 0, reactivated: 0,
    newListings: [], priceChangeDetails: [], removedListings: [], reactivatedListings: [], newIncentives: [],
  }

  try {
    console.log(`  [${BUILDER_NAME}] Scraping: ${row.communityName} -> ${row.url}`)
    await randomDelayMs(4_000, 10_000)

    let mapResult = await readTrumarkMap(row.url, row.communityName).catch(async (err: unknown) => {
      console.warn(`  [${BUILDER_NAME}] ${row.communityName}: first attempt failed, retrying in 30s...`)
      console.warn(err)
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return readTrumarkMap(row.url, row.communityName)
    })

    if ((mapResult.lots?.length ?? 0) === 0) {
      const dbCount = await prisma.listing.count({
        where: { community: { builderId, name: row.communityName }, status: { not: "removed" } },
      })
      if (dbCount > 0) {
        const msg = `${row.communityName}: zero available homes returned but DB has ${dbCount}; skipping to avoid false sold marks`
        console.warn(`  [${BUILDER_NAME}] ALERT: ${msg}`)
        return { scraped: 0, stats: emptyStats, error: { builder: BUILDER_NAME, error: msg } }
      }
    }

    const listings = buildListings(mapResult, row.communityName, row.url)
    const city = listings[0]?.city ?? trumarkCityFromUrl(row.url)
    const community = await withReconnect(() =>
      prisma.community.upsert({
        where: { builderId_name: { builderId, name: row.communityName } },
        update: { url: row.url, city },
        create: { builderId, name: row.communityName, city, state: "CA", url: row.url },
      })
    )

    const deduped = Array.from(
      new Map(listings.map((listing) => [`${listing.lotNumber ?? ""}|${listing.address}`, listing])).values()
    )
    const stats = await detectAndApplyChanges(deduped, community.id, BUILDER_NAME)
    console.log(`  [${BUILDER_NAME}] ${row.communityName}: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed/sold, ${stats.unchanged} unchanged`)

    return { scraped: deduped.length, stats }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`  [${BUILDER_NAME}] Error scraping ${row.communityName}:`, err)
    return { scraped: 0, stats: emptyStats, error: { builder: BUILDER_NAME, error: `${row.communityName}: ${errorMsg}` } }
  }
}

function appendResults(communities: number, errors: string[], startedAt: string, finishedAt: string) {
  try {
    let existing: Record<string, unknown> = {}
    if (existsSync(RESULTS_FILE)) {
      try { existing = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) } catch {}
    }
    existing[BUILDER_NAME] = {
      status: errors.length === 0 ? "success" : "failure",
      communities,
      errorCount: errors.length,
      errors: errors.slice(0, 3),
      startedAt,
      finishedAt,
    }
    writeFileSync(RESULTS_FILE, JSON.stringify(existing))
  } catch (err) {
    console.warn(`[${BUILDER_NAME}] Could not write results file:`, err)
  }
}

async function main() {
  const startedAt = new Date().toISOString()
  console.log("=".repeat(60))
  console.log(`${BUILDER_NAME} Scraper - ${startedAt}`)
  console.log("=".repeat(60))

  const errors: string[] = []
  let totalScraped = 0
  let communityCount = 0

  try {
    const communities = await fetchBuilderSheet()
    communityCount = communities.length
    console.log(`[${BUILDER_NAME}] ${communityCount} communities in sheet`)

    if (communityCount === 0) {
      appendResults(0, ["No communities found in sheet"], startedAt, new Date().toISOString())
      return
    }

    const builderRecord = await withReconnect(() =>
      prisma.builder.upsert({
        where: { name: BUILDER_NAME },
        update: { websiteUrl: WEBSITE_URL },
        create: { name: BUILDER_NAME, websiteUrl: WEBSITE_URL },
      })
    )

    for (const row of communities) {
      const result = await scrapeOneCommunity(builderRecord.id, row)
      totalScraped += result.scraped
      if (result.error) errors.push(result.error.error)
    }

    console.log(`\n[${BUILDER_NAME}] Done - ${totalScraped} listings processed, ${errors.length} errors`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[${BUILDER_NAME}] Fatal error:`, err)
    errors.push(`Fatal: ${msg}`)
  } finally {
    appendResults(communityCount, errors, startedAt, new Date().toISOString())
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("Unhandled:", err)
  process.exit(1)
})
