// One-off: scrape and save Alder at GPN only
import { fetchUrlsTab, fetchMainTabMeta, matchMetaForCommunity, applySheetDefaults } from "../lib/scraper/sheet-controller"
import { scrapeTollApollo } from "../lib/scraper/toll-brothers"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes"
import { prisma } from "../lib/db"

async function main() {
  const [urlRows, metaMap] = await Promise.all([fetchUrlsTab(), fetchMainTabMeta()])
  const urlRow = urlRows.find(r => r.communityName?.toLowerCase().includes("alder") && r.builder === "Toll Brothers")
  if (!urlRow) { console.log("Alder row not found in sheet"); return }

  const meta = matchMetaForCommunity(metaMap, urlRow.communityName)
  const communityDisplayName = meta?.displayName || urlRow.communityName
  const city = meta?.city || ""

  console.log(`Scraping: ${communityDisplayName} — ${urlRow.url}`)
  const result = await scrapeTollApollo(urlRow.url)

  const raw = result.lots.map(lot => {
    const s = lot.status.toLowerCase()
    const isQMI = lot.lotNum in result.lotPrices || lot.lotNum in result.lotAddresses
    const status = isQMI ? "active" : (s === "sold" || s === "reserved") ? "sold" : "future"
    const planName = lot.planName && lot.planName !== "no data" ? lot.planName : undefined
    const spec = planName
      ? (result.planSpecs[planName] ?? Object.entries(result.planSpecs).find(([k]) => planName.startsWith(k))?.[1])
      : undefined
    const price = result.lotPrices[lot.lotNum]
    const streetAddr = result.lotAddresses[lot.lotNum]
    const address = streetAddr ?? `Lot ${lot.lotNum}`
    return {
      communityName: urlRow.communityName, communityUrl: urlRow.url,
      address, lotNumber: lot.lotNum, status, floorPlan: planName,
      beds: spec?.beds, baths: spec?.baths, sqft: spec?.sqft,
      floors: spec?.floors, propertyType: spec?.propertyType,
      price, pricePerSqft: price && spec?.sqft ? Math.round(price / spec.sqft) : undefined,
      sourceUrl: urlRow.url,
    }
  })

  console.log(`  Scraped ${raw.length} listings`)

  const listings = applySheetDefaults(raw, urlRow, meta).map(l => ({
    ...l,
    pricePerSqft: l.price && l.sqft ? Math.round(l.price / l.sqft) : l.pricePerSqft,
  }))

  const builderRecord = await prisma.builder.upsert({
    where: { name: "Toll Brothers" },
    update: {},
    create: { name: "Toll Brothers", websiteUrl: "https://www.tollbrothers.com" },
  })

  const community = await prisma.community.upsert({
    where:  { builderId_name: { builderId: builderRecord.id, name: communityDisplayName } },
    update: { url: urlRow.url, city },
    create: { builderId: builderRecord.id, name: communityDisplayName, city, state: "CA", url: urlRow.url },
  })

  const stats = await detectAndApplyChanges(listings, community.id, urlRow.builder)
  console.log(`  Done: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
