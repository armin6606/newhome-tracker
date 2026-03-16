import { prisma } from "@/lib/db"
import { scrapeTollBrothersIrvine } from "./toll-brothers"
import { detectAndApplyChanges } from "./detect-changes"

export async function runScraper() {
  console.log(`[${new Date().toISOString()}] Starting scrape...`)

  // Ensure Toll Brothers builder exists
  const builder = await prisma.builder.upsert({
    where: { name: "Toll Brothers" },
    update: {},
    create: {
      name: "Toll Brothers",
      websiteUrl: "https://www.tollbrothers.com",
    },
  })

  const scrapedListings = await scrapeTollBrothersIrvine()
  console.log(`Scraped ${scrapedListings.length} total listings`)

  // Group by community
  const byCommunity = new Map<string, typeof scrapedListings>()
  for (const listing of scrapedListings) {
    const key = listing.communityName
    if (!byCommunity.has(key)) byCommunity.set(key, [])
    byCommunity.get(key)!.push(listing)
  }

  const totalStats = { added: 0, priceChanges: 0, removed: 0, unchanged: 0 }

  for (const [communityName, listings] of byCommunity.entries()) {
    const communityUrl = listings[0].communityUrl

    const community = await prisma.community.upsert({
      where: { builderId_name: { builderId: builder.id, name: communityName } },
      update: { url: communityUrl },
      create: {
        builderId: builder.id,
        name: communityName,
        city: "Irvine",
        state: "CA",
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

  console.log(
    `[${new Date().toISOString()}] Scrape complete:`,
    `+${totalStats.added} new,`,
    `${totalStats.priceChanges} price changes,`,
    `${totalStats.removed} removed`
  )

  return totalStats
}
