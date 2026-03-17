import { prisma } from "@/lib/db"
import { scrapeTollBrothersIrvine } from "./toll-brothers"
import { scrapeLennarIrvine } from "./lennar"
import { detectAndApplyChanges } from "./detect-changes"
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
    name: "Toll Brothers",
    websiteUrl: "https://www.tollbrothers.com",
    city: "Irvine",
    state: "CA",
    scrape: scrapeTollBrothersIrvine,
  },
  {
    name: "Lennar",
    websiteUrl: "https://www.lennar.com",
    city: "Irvine",
    state: "CA",
    scrape: scrapeLennarIrvine,
  },
]

export async function runScraper() {
  console.log(`[${new Date().toISOString()}] Starting scrape...`)

  const totalStats = { added: 0, priceChanges: 0, removed: 0, unchanged: 0 }

  for (const config of BUILDERS) {
    console.log(`\n--- ${config.name} ---`)

    const builder = await prisma.builder.upsert({
      where: { name: config.name },
      update: {},
      create: { name: config.name, websiteUrl: config.websiteUrl },
    })

    let scrapedListings: ScrapedListing[]
    try {
      scrapedListings = await config.scrape()
      console.log(`Scraped ${scrapedListings.length} total listings`)
    } catch (err) {
      console.error(`Error scraping ${config.name}:`, err)
      continue
    }

    // Deduplicate by sourceUrl (same listing can appear in parent + sub-community pages)
    const seenUrls = new Set<string>()
    const dedupedListings = scrapedListings.filter((l) => {
      if (seenUrls.has(l.sourceUrl)) return false
      seenUrls.add(l.sourceUrl)
      return true
    })
    console.log(`After dedup: ${dedupedListings.length} unique listings`)

    // Group by community
    const byCommunity = new Map<string, typeof scrapedListings>()
    for (const listing of dedupedListings) {
      const key = listing.communityName
      if (!byCommunity.has(key)) byCommunity.set(key, [])
      byCommunity.get(key)!.push(listing)
    }

    for (const [communityName, listings] of byCommunity.entries()) {
      const communityUrl = listings[0].communityUrl

      const community = await prisma.community.upsert({
        where: { builderId_name: { builderId: builder.id, name: communityName } },
        update: { url: communityUrl },
        create: {
          builderId: builder.id,
          name: communityName,
          city: config.city,
          state: config.state,
          url: communityUrl,
        },
      })

      const stats = await detectAndApplyChanges(listings, community.id)
      totalStats.added += stats.added
      totalStats.priceChanges += stats.priceChanges
      totalStats.removed += stats.removed
      totalStats.unchanged += stats.unchanged

      console.log(
        `  ${communityName}: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`
      )
    }
  }

  console.log(
    `\n[${new Date().toISOString()}] Scrape complete:`,
    `+${totalStats.added} new,`,
    `${totalStats.priceChanges} price changes,`,
    `${totalStats.removed} removed`
  )

  return totalStats
}
