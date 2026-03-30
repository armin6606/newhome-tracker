import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const ph = await prisma.priceHistory.deleteMany()
  console.log("PriceHistory deleted:", ph.count)
  const li = await prisma.listing.deleteMany()
  console.log("Listing deleted:", li.count)
  const co = await prisma.community.deleteMany()
  console.log("Community deleted:", co.count)
  const bu = await prisma.builder.deleteMany()
  console.log("Builder deleted:", bu.count)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
