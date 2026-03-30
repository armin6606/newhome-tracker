/**
 * One-off: scrape Rhea at Luna Park and add to DB.
 * Run with: npx tsx scripts/scrape-rhea.ts
 */
import { scrapeLennarCommunity } from "../lib/scraper/lennar"
import { applySheetDefaults }    from "../lib/scraper/sheet-controller"
import { detectAndApplyChanges } from "../lib/scraper/detect-changes"
import { prisma }                from "../lib/db"

const RHEA_URL = "https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/rhea-at-luna-park"

const URL_ROW  = { communityName: "Rhea", url: RHEA_URL, builder: "Lennar" }
const META     = { displayName: "Rhea (Luna Park)", city: "Irvine", builder: "Lennar", propertyType: "Duet", hoa: 643, taxRate: 1.89, schools: undefined, plans: new Map() }

async function main() {
  console.log("Scraping Rhea at Luna Park...")
  const raw = await scrapeLennarCommunity(RHEA_URL, "Rhea (Luna Park)")
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
    where:  { builderId_name: { builderId: builder.id, name: "Rhea (Luna Park)" } },
    update: { url: RHEA_URL, city: "Irvine" },
    create: { builderId: builder.id, name: "Rhea (Luna Park)", city: "Irvine", state: "CA", url: RHEA_URL },
  })

  const stats = await detectAndApplyChanges(listings, community.id, "Lennar")
  console.log(`Done: +${stats.added} new, ${stats.priceChanges} price changes, ${stats.removed} removed, ${stats.unchanged} unchanged`)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
