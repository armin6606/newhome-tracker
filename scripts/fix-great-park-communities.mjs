/**
 * Fix "Great Park Neighborhoods" generic community names:
 *
 * 1. Lennar community 37 ("Great Park Neighborhoods"):
 *    Split into "Rhea at Luna Park" and "Isla at Luna Park" based on source URL.
 *
 * 2. Toll Brothers community 1 ("Toll Brothers At Great Park Neighborhoods"):
 *    Reassign listings to the correct collection communities (IDs 2–6) based on URL.
 */

import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  // ── 1. Lennar: split community 37 into proper sub-communities ────────────
  const lennarBuilder = await prisma.builder.findFirst({ where: { name: "Lennar" } })
  const community37 = await prisma.community.findUnique({
    where: { id: 37 },
    select: { city: true, state: true, url: true },
  })

  // Find or create "Rhea at Luna Park"
  let rheaCommunity = await prisma.community.findFirst({ where: { name: "Rhea at Luna Park" } })
  if (!rheaCommunity) {
    rheaCommunity = await prisma.community.create({
      data: {
        name: "Rhea at Luna Park",
        city: community37.city,
        state: community37.state,
        url: "https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/rhea-at-luna-park",
        builderId: lennarBuilder.id,
      },
    })
    console.log(`Created community: Rhea at Luna Park (id=${rheaCommunity.id})`)
  }

  // Find or create "Isla at Luna Park"
  let islaCommunity = await prisma.community.findFirst({ where: { name: "Isla at Luna Park" } })
  if (!islaCommunity) {
    islaCommunity = await prisma.community.create({
      data: {
        name: "Isla at Luna Park",
        city: community37.city,
        state: community37.state,
        url: "https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/isla-at-luna-park",
        builderId: lennarBuilder.id,
      },
    })
    console.log(`Created community: Isla at Luna Park (id=${islaCommunity.id})`)
  }

  // Reassign listings based on URL slug
  const lennarListings = await prisma.listing.findMany({ where: { communityId: 37 }, select: { id: true, sourceUrl: true } })
  for (const l of lennarListings) {
    const slug = l.sourceUrl?.match(/great-park-neighborhoods\/([^\/]+)/)?.[1]
    if (slug === "rhea-at-luna-park") {
      await prisma.listing.update({ where: { id: l.id }, data: { communityId: rheaCommunity.id } })
    } else if (slug === "isla-at-luna-park") {
      await prisma.listing.update({ where: { id: l.id }, data: { communityId: islaCommunity.id } })
    }
  }
  console.log(`Reassigned ${lennarListings.length} Lennar listings from "Great Park Neighborhoods"`)

  // ── 2. Toll Brothers: reassign community 1 listings to collections ────────
  const collectionMap = {
    "Elm-Collection":   2,
    "Birch-Collection": 3,
    "Alder-Collection": 4,
    "Rowan-Collection": 5,
    "Laurel-Collection": 6,
  }

  const tbListings = await prisma.listing.findMany({ where: { communityId: 1 }, select: { id: true, address: true, sourceUrl: true } })
  let tbMoved = 0, tbDupes = 0
  for (const l of tbListings) {
    const slug = l.sourceUrl?.match(/Great-Park-Neighborhoods\/([^\/]+)/)?.[1]
    const targetId = collectionMap[slug]
    if (!targetId) continue
    // Check for duplicate in target community
    const existing = await prisma.listing.findUnique({ where: { communityId_address: { communityId: targetId, address: l.address } } })
    if (existing) {
      // Already exists in target — mark this duplicate as removed
      await prisma.listing.update({ where: { id: l.id }, data: { status: "removed" } })
      tbDupes++
    } else {
      await prisma.listing.update({ where: { id: l.id }, data: { communityId: targetId } })
      tbMoved++
    }
  }
  console.log(`Reassigned ${tbMoved}/${tbListings.length} Toll Brothers listings from generic community to collections`)

  // Summary
  const remaining1  = await prisma.listing.count({ where: { communityId: 1,  status: "active" } })
  const remaining37 = await prisma.listing.count({ where: { communityId: 37, status: "active" } })
  console.log(`\nRemaining active listings in community 1: ${remaining1}`)
  console.log(`Remaining active listings in community 37: ${remaining37}`)
  console.log("\nDone.")
}

main().catch(console.error).finally(() => prisma.$disconnect())
