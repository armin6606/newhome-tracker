/**
 * scrape-lennar-partial.ts
 * Re-scrape only the 3 communities that failed with P2002 in the full run.
 */
import { prisma } from "../lib/db"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes"
import { readLennarMap } from "../lib/scraper/map-readers/lennar-map"
import type { MapResult } from "../lib/scraper/map-readers/types"
import type { ScrapedListing } from "../lib/scraper/toll-brothers"

function buildListings(result: MapResult, communityName: string, communityUrl: string): ScrapedListing[] {
  if (result.lots && result.lots.length > 0) {
    return result.lots.map((lot) => {
      const status: string = lot.status === "active" && !lot.price ? "future" : lot.status
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

const TARGETS = [
  { communityName: "Torrey", url: "https://www.lennar.com/new-homes/california/orange-county/fullerton/pineridge/torrey" },
  { communityName: "Nova",   url: "https://www.lennar.com/new-homes/california/orange-county/rancho-mission-viejo/rancho-mission-viejo/nova--active-adult" },
  { communityName: "Strata", url: "https://www.lennar.com/new-homes/california/orange-county/rancho-mission-viejo/rancho-mission-viejo/strata--active-adult" },
]

async function main() {
  const builder = await prisma.builder.upsert({
    where: { name: "Lennar" },
    update: {},
    create: { name: "Lennar", websiteUrl: "https://www.lennar.com" },
  })

  for (const row of TARGETS) {
    console.log(`\nScraping: ${row.communityName}`)
    try {
      const mapResult = await readLennarMap(row.url, row.communityName)
      const listings  = buildListings(mapResult, row.communityName, row.url)
      if (listings.length === 0) { console.log(`  Skipping — 0 lots`); continue }

      const community = await prisma.community.upsert({
        where:  { builderId_name: { builderId: builder.id, name: row.communityName } },
        update: { url: row.url },
        create: { builderId: builder.id, name: row.communityName, city: "Orange County", state: "CA", url: row.url },
      })

      const stats = await detectAndApplyChanges(listings, community.id, "Lennar")
      console.log(`  ${row.communityName}: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
    } catch (err) {
      console.error(`  Error:`, err)
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
