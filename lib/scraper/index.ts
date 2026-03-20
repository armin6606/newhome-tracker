import { prisma } from "@/lib/db"
import { scrapeTollBrothersIrvine } from "./toll-brothers"
import { scrapeLennarIrvine } from "./lennar"
import { scrapeKBHomeOC } from "./kb-home"
import { scrapeTriPointeOC } from "./tri-pointe"
import { scrapeaSheaHomesOC } from "./shea-homes"
import { scrapePulteOC, scrapeDelWebbOC } from "./pulte"
import { scrapeTaylorMorrisonOC } from "./taylor-morrison"
import { scrapeMeliaHomesOC } from "./melia"
import { scrapeBrookfieldOC } from "./brookfield"
import { detectAndApplyChanges, type ChangeDetails } from "./detect-changes"
import { sendScrapeSummary } from "./scrape-summary"
import type { ScrapedListing } from "./toll-brothers"

interface BuilderConfig {
  name: string
  websiteUrl: string
  city: string
  state: string
  scrape: () => Promise<ScrapedListing[]>
}

const BUILDERS: BuilderConfig[] = [
  {
    name: "Lennar",
    websiteUrl: "https://www.lennar.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeLennarIrvine,
  },
  {
    name: "Toll Brothers",
    websiteUrl: "https://www.tollbrothers.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeTollBrothersIrvine,
  },
  {
    name: "KB Home",
    websiteUrl: "https://www.kbhome.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeKBHomeOC,
  },
  {
    name: "TRI Pointe Homes",
    websiteUrl: "https://www.tripointehomes.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeTriPointeOC,
  },
  {
    name: "Shea Homes",
    websiteUrl: "https://www.sheahomes.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeaSheaHomesOC,
  },
  {
    name: "Pulte Homes",
    websiteUrl: "https://www.pulte.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapePulteOC,
  },
  {
    name: "Del Webb",
    websiteUrl: "https://www.delwebb.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeDelWebbOC,
  },
  {
    name: "Taylor Morrison",
    websiteUrl: "https://www.taylormorrison.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeTaylorMorrisonOC,
  },
  {
    name: "Melia Homes",
    websiteUrl: "https://meliahomes.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeMeliaHomesOC,
  },
  {
    name: "Brookfield Residential",
    websiteUrl: "https://www.brookfieldresidential.com",
    city: "Orange County",
    state: "CA",
    scrape: scrapeBrookfieldOC,
  },
]

async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const msg = String(err)
    if (msg.includes("P1017") || msg.includes("connection") || msg.includes("closed")) {
      console.log("  Reconnecting to database...")
      await prisma.$disconnect()
      await new Promise((r) => setTimeout(r, 2000))
      await prisma.$connect()
      return await fn()
    }
    throw err
  }
}

/** Process a single builder: scrape, dedup, group by community, detect changes */
async function scrapeBuilder(config: BuilderConfig): Promise<{
  scraped: number
  stats: ChangeDetails
  error?: { builder: string; error: string }
}> {
  const stats: ChangeDetails = {
    added: 0, priceChanges: 0, removed: 0, unchanged: 0,
    newListings: [], priceChangeDetails: [], removedListings: [], newIncentives: [],
  }

  console.log(`\n--- ${config.name} ---`)

  const builder = await withReconnect(() => prisma.builder.upsert({
    where: { name: config.name },
    update: {},
    create: { name: config.name, websiteUrl: config.websiteUrl },
  }))

  let scrapedListings: ScrapedListing[]
  try {
    scrapedListings = await config.scrape()
    console.log(`[${config.name}] Scraped ${scrapedListings.length} total listings`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[${config.name}] Error:`, err)
    return { scraped: 0, stats, error: { builder: config.name, error: errorMsg } }
  }

  // Deduplicate by sourceUrl
  const seenUrls = new Set<string>()
  const dedupedListings = scrapedListings.filter((l) => {
    if (seenUrls.has(l.sourceUrl)) return false
    seenUrls.add(l.sourceUrl)
    return true
  })
  console.log(`[${config.name}] After dedup: ${dedupedListings.length} unique listings`)

  // Group by community
  const byCommunity = new Map<string, typeof scrapedListings>()
  for (const listing of dedupedListings) {
    const key = listing.communityName
    if (!byCommunity.has(key)) byCommunity.set(key, [])
    byCommunity.get(key)!.push(listing)
  }

  for (const [communityName, listings] of byCommunity.entries()) {
    const communityUrl = listings[0].communityUrl
    const listingCity = listings[0].city || config.city

    // Check if this community is excluded (user deleted it from the site)
    const existing = await withReconnect(() => prisma.community.findUnique({
      where: { builderId_name: { builderId: builder.id, name: communityName } },
      select: { excluded: true },
    }))
    if (existing?.excluded) {
      console.log(`  [${config.name}] Skipping excluded community: ${communityName}`)
      continue
    }

    const community = await withReconnect(() => prisma.community.upsert({
      where: { builderId_name: { builderId: builder.id, name: communityName } },
      update: {
        url: communityUrl,
        ...(listingCity !== config.city ? { city: listingCity } : {}),
      },
      create: {
        builderId: builder.id,
        name: communityName,
        city: listingCity,
        state: config.state,
        url: communityUrl,
      },
    }))

    const communityStats = await detectAndApplyChanges(listings, community.id, config.name)
    stats.added += communityStats.added
    stats.priceChanges += communityStats.priceChanges
    stats.removed += communityStats.removed
    stats.unchanged += communityStats.unchanged
    stats.newListings.push(...communityStats.newListings)
    stats.priceChangeDetails.push(...communityStats.priceChangeDetails)
    stats.removedListings.push(...communityStats.removedListings)
    stats.newIncentives.push(...communityStats.newIncentives)

    console.log(
      `  [${config.name}] ${communityName}: +${communityStats.added} new, ${communityStats.priceChanges} price changes, ${communityStats.removed} removed, ${communityStats.unchanged} unchanged`
    )
  }

  return { scraped: scrapedListings.length, stats }
}

// Max concurrent browser-based scrapers to avoid memory exhaustion
const MAX_CONCURRENT = 5

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = []
  const executing = new Set<Promise<void>>()

  for (const task of tasks) {
    const p = task().then((result) => { results.push(result) })
      .then(() => { executing.delete(p) })
    executing.add(p)

    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}

export async function runScraper() {
  const scrapeStartTime = new Date()
  console.log(`[${scrapeStartTime.toISOString()}] Starting scrape (${BUILDERS.length} builders, max ${MAX_CONCURRENT} concurrent)...`)

  // Run builders in parallel with concurrency limit
  const results = await runWithConcurrency(
    BUILDERS.map((config) => () => scrapeBuilder(config)),
    MAX_CONCURRENT
  )

  // Aggregate results
  const totalStats: ChangeDetails = {
    added: 0, priceChanges: 0, removed: 0, unchanged: 0,
    newListings: [], priceChangeDetails: [], removedListings: [], newIncentives: [],
  }
  let totalScraped = 0
  const errors: { builder: string; error: string }[] = []

  for (const r of results) {
    totalScraped += r.scraped
    totalStats.added += r.stats.added
    totalStats.priceChanges += r.stats.priceChanges
    totalStats.removed += r.stats.removed
    totalStats.unchanged += r.stats.unchanged
    totalStats.newListings.push(...r.stats.newListings)
    totalStats.priceChangeDetails.push(...r.stats.priceChangeDetails)
    totalStats.removedListings.push(...r.stats.removedListings)
    totalStats.newIncentives.push(...r.stats.newIncentives)
    if (r.error) errors.push(r.error)
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
      errors,
    })
    console.log("Scrape summary email sent to info@newkey.us")
  } catch (err) {
    console.error("Failed to send scrape summary email:", err)
  }

  return totalStats
}
