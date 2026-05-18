/**
 * setup-aneeq.ts
 *
 * One-time setup script: creates the "Aneeq" builder in DB and clones
 * every Lennar community (same name + URL) under it.
 *
 * "Aneeq" is a benchmark scraper that uses Lennar's own GraphQL API
 * directly. Compare its results against Lennar (main scraper) and
 * Mennar (Firecrawl AI scraper) to measure accuracy.
 *
 * Run: npx tsx scripts/setup-aneeq.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("═══ Aneeq Setup ═══\n")

  // ── 1. Find Lennar builder ────────────────────────────────────────────────
  const lennar = await prisma.builder.findFirst({ where: { name: "Lennar" } })
  if (!lennar) throw new Error("Lennar builder not found in DB — run Lennar scraper first")
  console.log(`Lennar builder: id=${lennar.id}`)

  // ── 2. Upsert Aneeq builder ───────────────────────────────────────────────
  const aneeq = await prisma.builder.upsert({
    where:  { name: "Aneeq" },
    create: { name: "Aneeq", websiteUrl: "https://www.lennar.com" },
    update: {},
  })
  console.log(`Aneeq builder: id=${aneeq.id}\n`)

  // ── 3. Fetch all Lennar communities ───────────────────────────────────────
  const lennarCommunities = await prisma.community.findMany({
    where:   { builderId: lennar.id },
    select:  { id: true, name: true, url: true, city: true, state: true },
    orderBy: { name: "asc" },
  })
  console.log(`Found ${lennarCommunities.length} Lennar communities to clone:\n`)

  let created = 0, updated = 0
  for (const c of lennarCommunities) {
    await prisma.community.upsert({
      where:  { builderId_name: { builderId: aneeq.id, name: c.name } },
      create: {
        builderId: aneeq.id,
        name:      c.name,
        url:       c.url,
        city:      c.city ?? "Irvine",
        state:     c.state ?? "CA",
      },
      update: { url: c.url },
    })
    const existed = await prisma.community.count({
      where: { builderId: aneeq.id, name: c.name },
    })
    const symbol = existed > 1 ? "↻" : "✓"
    console.log(`  ${symbol} ${c.name}  →  ${c.url}`)
    existed > 1 ? updated++ : created++
  }

  console.log(`\nDone — ${created} created, ${updated} updated`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
