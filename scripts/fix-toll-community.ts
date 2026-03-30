/**
 * Fix duplicate Toll Brothers communities created by the scraper using "Elm at GPN"
 * while the original data was saved under "Elm Collection".
 *
 * Steps:
 * 1. Find both communities
 * 2. Delete all listings under "Elm at GPN" (duplicates — the good data is under "Elm Collection")
 * 3. Delete the "Elm at GPN" community
 * 4. Rename "Elm Collection" → "Elm at GPN" so future scrapes find it correctly
 */
import { prisma } from "@/lib/db"

async function main() {
  const builder = await prisma.builder.findFirst({ where: { name: "Toll Brothers" } })
  if (!builder) { console.log("No Toll Brothers builder found"); return }

  const communities = await prisma.community.findMany({
    where: { builderId: builder.id },
    include: { _count: { select: { listings: true } } }
  })

  console.log("Toll Brothers communities in DB:")
  communities.forEach(c => console.log(`  id=${c.id} name="${c.name}" listings=${c._count.listings}`))

  const elmAtGpn    = communities.find(c => c.name === "Elm at GPN")
  const elmCollection = communities.find(c => c.name === "Elm Collection")

  if (!elmAtGpn && !elmCollection) {
    console.log("\nNeither community found — nothing to fix")
    return
  }

  if (elmAtGpn && elmCollection) {
    // Delete price history for those listings first (FK constraint)
    const dupeListingIds = await prisma.listing.findMany({
      where: { communityId: elmAtGpn.id },
      select: { id: true }
    })
    await prisma.priceHistory.deleteMany({ where: { listingId: { in: dupeListingIds.map(l => l.id) } } })

    // Now delete the duplicate "Elm at GPN" listings + community
    const deleted = await prisma.listing.deleteMany({ where: { communityId: elmAtGpn.id } })
    console.log(`\nDeleted ${deleted.count} duplicate listings from "Elm at GPN"`)
    await prisma.community.delete({ where: { id: elmAtGpn.id } })
    console.log(`Deleted community "Elm at GPN" (id=${elmAtGpn.id})`)

    // Rename "Elm Collection" → "Elm at GPN"
    await prisma.community.update({
      where: { id: elmCollection.id },
      data: { name: "Elm at GPN" }
    })
    console.log(`Renamed "Elm Collection" → "Elm at GPN" (id=${elmCollection.id})`)
  } else if (elmCollection && !elmAtGpn) {
    // Just rename it
    await prisma.community.update({
      where: { id: elmCollection.id },
      data: { name: "Elm at GPN" }
    })
    console.log(`\nRenamed "Elm Collection" → "Elm at GPN"`)
  } else {
    console.log("\n\"Elm at GPN\" already exists, nothing to rename")
  }

  // Verify final state
  const final = await prisma.community.findMany({
    where: { builderId: builder.id },
    include: { _count: { select: { listings: true } } }
  })
  console.log("\nFinal state:")
  final.forEach(c => console.log(`  id=${c.id} name="${c.name}" listings=${c._count.listings}`))

  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
