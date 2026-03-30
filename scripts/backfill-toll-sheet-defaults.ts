/**
 * Backfill sheet defaults onto all existing Toll Brothers listings in the DB.
 * Applies floorPlan, beds, baths, sqft, floors, HOA, schools from the Main tab.
 * Sheet data always wins over current DB values.
 */
import { prisma } from "@/lib/db"
import { fetchUrlsTab, fetchMainTabMeta, matchMetaForCommunity, applySheetDefaults } from "@/lib/scraper/sheet-controller"

async function main() {
  const [urls, meta] = await Promise.all([fetchUrlsTab(), fetchMainTabMeta()])

  // Get all Toll Brothers listings
  const listings = await prisma.listing.findMany({
    where: { community: { builder: { name: "Toll Brothers" } } },
    include: { community: true },
  })

  console.log(`Found ${listings.length} Toll Brothers listings to backfill\n`)

  let updated = 0
  let skipped = 0

  for (const listing of listings) {
    const communityName = listing.community.name
    const urlRow = urls.find(r =>
      communityName.toLowerCase().includes(r.communityName.toLowerCase()) ||
      r.communityName.toLowerCase().includes(communityName.toLowerCase().split(/[\s(]/)[0])
    )
    if (!urlRow) {
      console.log(`  ⚠ No URL row match for: ${communityName}`)
      skipped++
      continue
    }

    const communityMeta = matchMetaForCommunity(meta, urlRow.communityName)

    // Build a mock ScrapedListing with the current DB values
    const mockListing = {
      communityName: listing.community.name,
      communityUrl:  listing.community.url,
      city:          listing.community.city,
      address:       listing.address ?? "",
      floorPlan:     listing.floorPlan  ?? undefined,
      beds:          listing.beds       ?? undefined,
      baths:         listing.baths      ?? undefined,
      sqft:          listing.sqft       ?? undefined,
      floors:        listing.floors     ?? undefined,
      hoaFees:       listing.hoaFees    ?? undefined,
      schools:       listing.schools    ?? undefined,
      sourceUrl:     listing.sourceUrl  ?? "",
    }

    const [applied] = applySheetDefaults([mockListing], urlRow, communityMeta)

    // Only update fields that the sheet actually provided (applied value must be defined, not undefined)
    // undefined means the sheet had no data for that field — don't overwrite what's in the DB
    const changes: Record<string, unknown> = {}
    if (applied.floorPlan !== undefined && applied.floorPlan !== listing.floorPlan)   changes.floorPlan = applied.floorPlan
    if (applied.beds      !== undefined && applied.beds      !== listing.beds)         changes.beds      = applied.beds
    if (applied.baths     !== undefined && applied.baths     !== listing.baths)        changes.baths     = applied.baths
    if (applied.sqft      !== undefined && applied.sqft      !== listing.sqft)         changes.sqft      = applied.sqft
    if (applied.floors    !== undefined && applied.floors    !== listing.floors)       changes.floors    = applied.floors
    if (applied.hoaFees   !== undefined && applied.hoaFees   !== listing.hoaFees)      changes.hoaFees   = applied.hoaFees
    if (applied.schools   !== undefined && applied.schools   !== listing.schools)      changes.schools   = applied.schools

    if (Object.keys(changes).length === 0) {
      skipped++
      continue
    }

    await prisma.listing.update({ where: { id: listing.id }, data: changes })
    console.log(`  ✓ ${communityName} | ${listing.address} | plan: ${listing.floorPlan ?? "—"} → ${applied.floorPlan ?? "—"} | changes: ${Object.keys(changes).join(", ")}`)
    updated++
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped`)
  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
