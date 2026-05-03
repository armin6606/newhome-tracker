import { prisma } from "../lib/db"

async function main() {
  const listings = await prisma.listing.findMany({ where: { address: "100 Test" }, select: { id: true } })
  if (listings.length) {
    await prisma.priceHistory.deleteMany({ where: { listingId: { in: listings.map(l => l.id) } } })
    await prisma.listing.deleteMany({ where: { address: "100 Test" } })
    console.log("Cleaned up", listings.length, "test listing(s)")
  } else {
    console.log("No test listings found")
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
