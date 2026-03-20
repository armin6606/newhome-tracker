import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

const PLAN_MAP = {
  rhea: "Rhea at Luna Park",
  isla: "Isla at Luna Park",
  nova: "Nova - Active Adult",
  strata: "Strata - Active Adult",
}

async function main() {
  const gpCommunity = await p.community.findFirst({
    where: { name: "Great Park Neighborhoods", builder: { name: "Lennar" } },
    include: { builder: true },
  })

  if (!gpCommunity) {
    console.log("No 'Great Park Neighborhoods' community found. Nothing to fix.")
    return
  }

  const listings = await p.listing.findMany({
    where: { communityId: gpCommunity.id, status: "active" },
    select: { id: true, address: true, floorPlan: true },
  })

  console.log(`Found ${listings.length} active listings in Great Park Neighborhoods`)

  let moved = 0
  for (const listing of listings) {
    const planPrefix = (listing.floorPlan || "").split(/\s+/)[0].toLowerCase()
    const targetName = PLAN_MAP[planPrefix]
    if (!targetName) {
      console.log(`  Skipping ${listing.address} — plan "${listing.floorPlan}" not mapped`)
      continue
    }

    const targetCommunity = await p.community.findFirst({
      where: { name: targetName, builderId: gpCommunity.builderId },
    })

    if (!targetCommunity) {
      console.log(`  Skipping ${listing.address} — community "${targetName}" not found`)
      continue
    }

    await p.listing.update({
      where: { id: listing.id },
      data: { communityId: targetCommunity.id },
    })
    console.log(`  Moved ${listing.address} (${listing.floorPlan}) → ${targetName}`)
    moved++
  }

  console.log(`\nDone. Moved ${moved} listings.`)

  // If no active listings remain, mark Great Park as excluded
  const remaining = await p.listing.count({ where: { communityId: gpCommunity.id, status: "active" } })
  if (remaining === 0) {
    await p.community.update({ where: { id: gpCommunity.id }, data: { excluded: true } })
    console.log("Marked 'Great Park Neighborhoods' as excluded (no active listings remaining)")
  }
}

main().catch(console.error).finally(() => p.$disconnect())
