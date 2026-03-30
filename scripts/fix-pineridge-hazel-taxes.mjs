/**
 * Bulk-set taxes for Pineridge - Hazel listings.
 * Tax rate = 1.4% (confirmed from live Lennar property-details page before expiry).
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const listings = await prisma.listing.findMany({
    where: {
      taxes: null,
      currentPrice: { not: null },
      community: { name: "Pineridge - Hazel", builder: { name: "Lennar" } },
    },
    select: { id: true, address: true, currentPrice: true },
  })

  console.log(`Found ${listings.length} Pineridge - Hazel listings missing taxes`)

  let updated = 0
  for (const l of listings) {
    const taxes = Math.round(l.currentPrice * 0.014)
    await prisma.listing.update({ where: { id: l.id }, data: { taxes } })
    console.log(`  ✓ [${l.id}] ${l.address} → taxes=$${taxes.toLocaleString()} (1.4% of $${l.currentPrice.toLocaleString()})`)
    updated++
  }

  console.log(`\nUpdated ${updated} listings.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
