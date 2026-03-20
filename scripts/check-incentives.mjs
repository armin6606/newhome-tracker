import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

const listings = await p.listing.findMany({
  where: { incentives: { not: null }, status: "active" },
  select: {
    incentives: true,
    community: { select: { name: true, builder: { select: { name: true } } } },
  },
  distinct: ["communityId"],
  orderBy: { community: { builder: { name: "asc" } } },
})

console.log(`${listings.length} communities with incentives:\n`)
for (const l of listings) {
  console.log(`[${l.community.builder.name}] ${l.community.name}`)
  console.log(`  → ${l.incentives?.slice(0, 150)}`)
  console.log()
}

// Check which builders have NO incentives at all
const builders = await p.builder.findMany({
  select: {
    name: true,
    communities: {
      select: {
        listings: {
          where: { status: "active", incentives: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    },
  },
})

console.log("--- Builders with NO incentives ---")
for (const b of builders) {
  const hasAny = b.communities.some(c => c.listings.length > 0)
  if (!hasAny) console.log(`  ${b.name} — NO incentives found`)
}

await p.$disconnect()
