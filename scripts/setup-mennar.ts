/**
 * setup-mennar.ts
 *
 * One-time setup script: creates the "Mennar" builder in DB and clones
 * every Lennar community (same name + URL) under it so Firecrawl can
 * scrape them independently for accuracy comparison.
 *
 * Run: npx tsx scripts/setup-mennar.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("═══ Mennar Setup ═══\n")

  // ── 1. Find Lennar builder ────────────────────────────────────────────────
  const lennar = await prisma.builder.findFirst({ where: { name: "Lennar" } })
  if (!lennar) throw new Error("Lennar builder not found in DB — run Lennar scraper first")
  console.log(`Lennar builder: id=${lennar.id}`)

  // ── 2. Upsert Mennar builder ──────────────────────────────────────────────
  const mennar = await prisma.builder.upsert({
    where:  { name: "Mennar" },
    create: { name: "Mennar", websiteUrl: "https://www.lennar.com" },
    update: {},
  })
  console.log(`Mennar builder: id=${mennar.id}\n`)

  // ── 3. Fetch all Lennar communities ───────────────────────────────────────
  const lennarCommunities = await prisma.community.findMany({
    where: { builderId: lennar.id },
    select: { id: true, name: true, url: true, city: true, state: true },
  })
  console.log(`Found ${lennarCommunities.length} Lennar communities to clone:\n`)

  let created = 0, updated = 0
  for (const c of lennarCommunities) {
    const result = await prisma.community.upsert({
      where:  { builderId_name: { builderId: mennar.id, name: c.name } },
      create: {
        builderId: mennar.id,
        name:      c.name,
        url:       c.url,
        city:      c.city ?? "Irvine",
        state:     c.state ?? "CA",
      },
      update: { url: c.url },
    })
    const isNew = result.id > 0
    const existed = await prisma.community.count({
      where: { builderId: mennar.id, name: c.name, id: { not: result.id } },
    })
    console.log(`  ${existed > 0 ? "↻" : "✓"} ${c.name}  →  ${c.url}`)
    existed > 0 ? updated++ : created++
  }

  console.log(`\nDone — ${created} created, ${updated} updated`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
