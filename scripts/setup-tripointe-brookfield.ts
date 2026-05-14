/**
 * setup-tripointe-brookfield.ts
 *
 * One-time setup: creates TRI Pointe Homes and Brookfield Residential builders
 * + their known communities in the DB so the scrapers can ingest listings.
 *
 * Run: npx tsx scripts/setup-tripointe-brookfield.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("═══ TRI Pointe Homes + Brookfield Residential Setup ═══\n")

  // ── TRI Pointe Homes ──────────────────────────────────────────────────────
  const tripointe = await prisma.builder.upsert({
    where:  { name: "TRI Pointe Homes" },
    create: { name: "TRI Pointe Homes", websiteUrl: "https://www.tripointehomes.com" },
    update: {},
  })
  console.log(`TRI Pointe Homes: id=${tripointe.id}`)

  const triCommunities = [
    {
      name: "Lavender at Rancho Mission Viejo",
      city: "Rancho Mission Viejo",
      url:  "https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo",
    },
    {
      name: "Heatherly at Rancho Mission Viejo",
      city: "Rancho Mission Viejo",
      url:  "https://www.tripointehomes.com/ca/orange-county/heatherly-at-rancho-mission-viejo",
    },
    {
      name: "Naya at Luna Park",
      city: "Irvine",
      url:  "https://www.tripointehomes.com/ca/orange-county/naya-at-luna-park",
    },
  ]

  for (const c of triCommunities) {
    await prisma.community.upsert({
      where:  { builderId_name: { builderId: tripointe.id, name: c.name } },
      create: { builderId: tripointe.id, name: c.name, city: c.city, state: "CA", url: c.url },
      update: { url: c.url },
    })
    console.log(`  ✓ ${c.name}`)
  }

  // ── Brookfield Residential ────────────────────────────────────────────────
  console.log("")
  const brookfield = await prisma.builder.upsert({
    where:  { name: "Brookfield Residential" },
    create: { name: "Brookfield Residential", websiteUrl: "https://www.brookfieldresidential.com" },
    update: {},
  })
  console.log(`Brookfield Residential: id=${brookfield.id}`)

  await prisma.community.upsert({
    where:  { builderId_name: { builderId: brookfield.id, name: "Vista in Summit Collection" } },
    create: {
      builderId: brookfield.id,
      name:  "Vista in Summit Collection",
      city:  "Irvine",
      state: "CA",
      url:   "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit",
    },
    update: {
      url: "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit",
    },
  })
  console.log(`  ✓ Vista in Summit Collection`)

  console.log("\n✅ Done")
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
