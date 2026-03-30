/**
 * Manual incentives update based on scraped data (3/20/2026)
 * Run with: node scripts/update-incentives-manual.mjs
 */
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

const UPDATES = [
  {
    builderPattern: "tri pointe",
    incentives: "4.75% (6.066% APR) Conventional 7-year ARM Financing — For a limited time, enjoy 4.75% (6.066% APR) conventional 7-year ARM financing at Rancho Mission Viejo. Sign purchase agreement 3/17–3/31/2026, close by 5/15/2026. Must finance through Tri Pointe Connect.",
    incentivesUrl: "https://www.tripointehomes.com/promotion/ca/orange-county/4-75-percent-6-066-percent-APR-Conventional-7-year-ARM-Financing-at-Rancho-Mission-Viejo",
  },
  {
    builderPattern: "taylor morrison",
    incentives: "Reduced Rate and No Monthly Mortgage Insurance — Secure a reduced rate on a new home today. Valid on contracts 3/20–3/31/2026. Must use Taylor Morrison Home Funding and selected closing agent. Conventional loan only.",
    incentivesUrl: "https://www.taylormorrison.com/make-moves",
  },
]

const CLEAR_BUILDERS = ["shea", "pulte", "kb home", "brookfield"]

async function main() {
  // Apply incentives for TRI Pointe and Taylor Morrison
  for (const update of UPDATES) {
    const communities = await prisma.community.findMany({
      where: { builder: { name: { contains: update.builderPattern, mode: "insensitive" } } },
      include: { listings: { where: { status: "active" }, select: { id: true } } },
    })
    let count = 0
    for (const c of communities) {
      const ids = c.listings.map((l) => l.id)
      if (!ids.length) continue
      await prisma.listing.updateMany({
        where: { id: { in: ids } },
        data: { incentives: update.incentives, incentivesUrl: update.incentivesUrl },
      })
      count += ids.length
      console.log(`  ✓ ${c.name} — ${ids.length} listings`)
    }
    console.log(`[${update.builderPattern}] Updated ${count} listings\n`)
  }

  // Clear incentives for builders with no active promos
  for (const builderPattern of CLEAR_BUILDERS) {
    const communities = await prisma.community.findMany({
      where: { builder: { name: { contains: builderPattern, mode: "insensitive" } } },
      include: { listings: { where: { status: "active" }, select: { id: true } } },
    })
    let count = 0
    for (const c of communities) {
      const ids = c.listings.map((l) => l.id)
      if (!ids.length) continue
      await prisma.listing.updateMany({
        where: { id: { in: ids } },
        data: { incentives: null, incentivesUrl: null },
      })
      count += ids.length
    }
    console.log(`[${builderPattern}] Cleared incentives for ${count} listings`)
  }

  await prisma.$disconnect()
  console.log("\nDone.")
}

main().catch((e) => { console.error(e); process.exit(1) })
