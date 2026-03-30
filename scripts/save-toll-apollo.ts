/**
 * save-toll-apollo.ts
 * Runs the Toll Apollo map scraper on Elm Collection and saves all lots to the DB.
 * Rules:
 *   - User-entered data (any non-null field) is NEVER overwritten
 *   - Empty/null fields are filled with scraped values
 *   - Active (For Sale) lots are printed at the end for manual entry
 */
import { prisma } from "@/lib/db"
import { scrapeTollApollo } from "@/lib/scraper/toll-brothers"

const COMMUNITY_NAME = "Elm Collection"
const COMMUNITY_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"
const BUILDER_NAME = "Toll Brothers"
const BUILDER_URL = "https://www.tollbrothers.com"

async function main() {
  console.log("[TollApollo Save] Scraping Elm Collection map...")
  const result = await scrapeTollApollo(COMMUNITY_URL)

  console.log(
    `\n[TollApollo Save] Map results — For Sale: ${result.forSale} | Sold: ${result.sold} | Future: ${result.future} | Total: ${result.total}`
  )
  console.log("[TollApollo Save] Plan specs:", JSON.stringify(result.planSpecs, null, 2))

  // Upsert builder
  const builder = await prisma.builder.upsert({
    where: { name: BUILDER_NAME },
    update: {},
    create: { name: BUILDER_NAME, websiteUrl: BUILDER_URL },
  })

  // Upsert community
  const community = await prisma.community.upsert({
    where: { builderId_name: { builderId: builder.id, name: COMMUNITY_NAME } },
    update: { url: COMMUNITY_URL },
    create: {
      builderId: builder.id,
      name: COMMUNITY_NAME,
      city: "Irvine",
      state: "CA",
      url: COMMUNITY_URL,
    },
  })

  console.log(`[TollApollo Save] Community id=${community.id} — processing ${result.lots.length} lots...`)

  let saved = 0
  let skipped = 0

  for (const lot of result.lots) {
    const s = lot.status.toLowerCase()
    let dbStatus: string
    const isQMI = lot.lotNum in result.lotPrices || lot.lotNum in result.lotAddresses
    if (isQMI) {
      dbStatus = "active"
    } else if (s === "sold" || s === "reserved") {
      dbStatus = "sold"
    } else {
      dbStatus = "future"
    }

    const address = `Lot ${lot.lotNum}`
    const planName = lot.planName !== "no data" ? lot.planName : undefined
    const spec = planName ? result.planSpecs[planName] : undefined

    try {
      // Fetch existing record — user-filled fields take priority
      const existing = await prisma.listing.findUnique({
        where: { communityId_address: { communityId: community.id, address } },
        select: { id: true, beds: true, baths: true, sqft: true, floorPlan: true, lotNumber: true, status: true },
      })

      if (existing) {
        // Only fill null/empty fields — never overwrite user data
        await prisma.listing.update({
          where: { communityId_address: { communityId: community.id, address } },
          data: {
            status: dbStatus,
            lotNumber: existing.lotNumber ?? lot.lotNum,
            floorPlan: existing.floorPlan ?? planName,
            beds: existing.beds ?? spec?.beds,
            baths: existing.baths ?? spec?.baths,
            sqft: existing.sqft ?? spec?.sqft,
            sourceUrl: COMMUNITY_URL,
          },
        })
      } else {
        await prisma.listing.create({
          data: {
            communityId: community.id,
            address,
            lotNumber: lot.lotNum,
            floorPlan: planName,
            beds: spec?.beds,
            baths: spec?.baths,
            sqft: spec?.sqft,
            status: dbStatus,
            sourceUrl: COMMUNITY_URL,
          },
        })
      }
      saved++
    } catch (err) {
      console.error(`  Error saving lot ${lot.lotNum}:`, err)
      skipped++
    }
  }

  console.log(`\n[TollApollo Save] Done — ${saved} lots saved, ${skipped} errors`)

  // Print active lots table for manual entry
  const activeLots = result.lots.filter((l) => {
    return l.lotNum in result.lotPrices || l.lotNum in result.lotAddresses
  })

  console.log(`\n${"═".repeat(72)}`)
  console.log(`  ACTIVE LOTS (For Sale) — ${activeLots.length} homes`)
  console.log(`${"═".repeat(72)}`)
  console.log(`  ${"Lot".padEnd(6)} ${"Plan".padEnd(12)} ${"Beds".padEnd(8)} ${"Baths".padEnd(8)} ${"Sqft"}`)
  console.log(`  ${"─".repeat(68)}`)
  for (const lot of activeLots) {
    const planName = lot.planName !== "no data" ? lot.planName : "—"
    const spec = planName !== "—" ? result.planSpecs[planName] : undefined
    const bedsStr = spec?.beds != null
      ? spec.bedsMax ? `${spec.beds}–${spec.bedsMax}` : String(spec.beds)
      : "—"
    const bathsStr = spec?.baths != null ? String(spec.baths) : "—"
    const sqftStr = spec?.sqft != null ? spec.sqft.toLocaleString() : "—"
    console.log(
      `  ${lot.lotNum.padEnd(6)} ${planName.padEnd(12)} ${bedsStr.padEnd(8)} ${bathsStr.padEnd(8)} ${sqftStr}`
    )
  }
  console.log(`${"═".repeat(72)}\n`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
