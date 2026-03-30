/**
 * One-off: scrape Isla at Luna Park and add to DB.
 * Run with: npx tsx scripts/scrape-isla.ts
 */
import { scrapeLennarCommunity } from "../lib/scraper/lennar"
import { applySheetDefaults }    from "../lib/scraper/sheet-controller"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes"
import { prisma }                from "../lib/db"

const ISLA_URL = "https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/isla-at-luna-park"

const URL_ROW  = { communityName: "Isla", url: ISLA_URL, builder: "Lennar" }
const META     = { displayName: "Isla (Luna Park)", city: "Irvine", builder: "Lennar", propertyType: "Attached", hoa: 260, taxRate: 1.89, schools: "Saddleback Valley USD, Serrano Intermediate, El Toro High", plans: new Map() }

async function main() {
  console.log("Scraping Isla at Luna Park...")
  const raw = await scrapeLennarCommunity(ISLA_URL, "Isla (Luna Park)")
  console.log(`Scraped ${raw.length} listings`)

  if (raw.length === 0) {
    console.log("No listings found — exiting")
    process.exit(0)
  }

  const listings = applySheetDefaults(raw, URL_ROW, META)

  const builder = await prisma.builder.upsert({
    where:  { name: "Lennar" },
    update: {},
    create: { name: "Lennar", websiteUrl: "https://www.lennar.com" },
  })

  const community = await prisma.community.upsert({
    where:  { builderId_name: { builderId: builder.id, name: "Isla (Luna Park)" } },
    update: { url: ISLA_URL, city: "Irvine" },
    create: { builderId: builder.id, name: "Isla (Luna Park)", city: "Irvine", state: "CA", url: ISLA_URL },
  })

  const stats = await detectAndApplyChanges(listings, community.id, "Lennar")
  console.log(`Done: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
