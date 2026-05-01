/**
 * scrape-delwebb-only.ts
 * Re-scrape all Del Webb communities with the fixed AlphaVision map reader.
 * Run: npx tsx --env-file=.env.local scripts/scrape-delwebb-only.ts
 */
import { prisma } from "../lib/db"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes"
import { fetchBuilderSheet } from "../lib/scraper/sheet-reader"
import { readDelWebbMap } from "../lib/scraper/map-readers/del-webb-map"
import type { MapResult } from "../lib/scraper/map-readers/types"
import type { ScrapedListing } from "../lib/scraper/toll-brothers"

function buildListings(result: MapResult, communityName: string, communityUrl: string): ScrapedListing[] {
  if (result.lots && result.lots.length > 0) {
    return result.lots.map((lot) => {
      // Preserve "active" when the lot has a real street address (e.g. QMI lots)
      const hasRealAddress = lot.address && !/^(lot|avail|sold|future)\s*[-\d]/i.test(lot.address)
      const status: string = lot.status === "active" && !lot.price && !hasRealAddress ? "future" : lot.status
      return {
        communityName, communityUrl,
        address: lot.address ?? `Lot ${lot.lotNumber}`,
        lotNumber: lot.lotNumber,
        floorPlan: lot.floorPlan,
        beds: lot.beds, baths: lot.baths, sqft: lot.sqft,
        price: status === "active" ? lot.price : undefined,
        pricePerSqft: status === "active" && lot.price && lot.sqft ? Math.round(lot.price / lot.sqft) : undefined,
        status,
        sourceUrl: communityUrl,
      } satisfies ScrapedListing
    })
  }
  const listings: ScrapedListing[] = []
  for (let i = 1; i <= result.sold; i++)    listings.push({ communityName, communityUrl, address: `sold-${i}`,   lotNumber: `sold-${i}`,   status: "sold",   sourceUrl: communityUrl })
  for (let i = 1; i <= result.forSale; i++) listings.push({ communityName, communityUrl, address: `avail-${i}`,  lotNumber: `avail-${i}`,  status: "active", sourceUrl: communityUrl })
  for (let i = 1; i <= result.future; i++)  listings.push({ communityName, communityUrl, address: `future-${i}`, lotNumber: `future-${i}`, status: "future", sourceUrl: communityUrl })
  return listings
}

async function main() {
  console.log("=== Del Webb re-scrape ===")
  const communities = await fetchBuilderSheet("847960742")
  console.log(`Found ${communities.length} Del Webb communities in sheet`)

  const builder = await prisma.builder.upsert({
    where: { name: "Del Webb" },
    update: {},
    create: { name: "Del Webb", websiteUrl: "https://www.delwebb.com" },
  })

  let totalAdded = 0, totalChanged = 0, totalRemoved = 0

  for (const row of communities) {
    console.log(`\n[DelWebb] Scraping: ${row.communityName} → ${row.url}`)
    try {
      const mapResult = await readDelWebbMap(row.url, row.communityName)
      const listings  = buildListings(mapResult, row.communityName, row.url)

      if (listings.length === 0) {
        console.log(`  Skipping ${row.communityName} — 0 lots returned`)
        continue
      }

      const community = await prisma.community.upsert({
        where:  { builderId_name: { builderId: builder.id, name: row.communityName } },
        update: { url: row.url },
        create: { builderId: builder.id, name: row.communityName, city: "Orange County", state: "CA", url: row.url },
      })

      const stats = await detectAndApplyChanges(listings, community.id, "Del Webb")
      console.log(`  ${row.communityName}: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
      totalAdded   += stats.added
      totalChanged += stats.priceChanges
      totalRemoved += stats.removed
    } catch (err) {
      console.error(`  Error scraping ${row.communityName}:`, err)
    }
  }

  console.log(`\n=== Done: +${totalAdded} new, ${totalChanged} price changes, ${totalRemoved} removed ===`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
