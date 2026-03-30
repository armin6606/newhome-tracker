/**
 * One-off script: scrape Rhea at Luna Park and add to DB.
 * Run with: node scripts/scrape-rhea.mjs
 */
import { scrapeLennarCommunity } from "../lib/scraper/lennar.js"
import { applySheetDefaults }    from "../lib/scraper/sheet-controller.js"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes.js"
import { prisma }                from "../lib/db.js"

const RHEA_URL = "https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/rhea-at-luna-park"

const META = {
  rowIndex:     99,
  url:          RHEA_URL,
  community:    "Rhea (Luna Park)",
  city:         "Irvine",
  builder:      "Lennar",
  propertyType: "Duet",
  hoa:          643,
  taxRate:      1.89,
}

console.log("Scraping Rhea at Luna Park...")
const raw = await scrapeLennarCommunity(RHEA_URL, "Rhea (Luna Park)")
console.log(`Scraped ${raw.length} listings`)

if (raw.length === 0) {
  console.log("No listings found — exiting")
  process.exit(0)
}

const listings = applySheetDefaults(raw, META)

// Upsert builder + community
const builder = await prisma.builder.upsert({
  where: { name: "Lennar" },
  update: {},
  create: { name: "Lennar", websiteUrl: "https://www.lennar.com" },
})

const community = await prisma.community.upsert({
  where: { builderId_name: { builderId: builder.id, name: "Rhea (Luna Park)" } },
  update: { url: RHEA_URL, city: "Irvine" },
  create: { builderId: builder.id, name: "Rhea (Luna Park)", city: "Irvine", state: "CA", url: RHEA_URL },
})

const stats = await detectAndApplyChanges(listings, community.id, "Lennar")
console.log(`Done: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
process.exit(0)
