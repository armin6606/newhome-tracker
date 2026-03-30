import { prisma } from "../lib/db"

async function cleanup() {
  const community = await prisma.community.findFirst({
    where: { name: "Nova (Active Adults)" },
    include: { _count: { select: { listings: true } } },
  })

  if (!community) {
    console.log("Community 'Nova (Active Adults)' not found — already clean")
    await prisma.$disconnect()
    return
  }

  console.log(`Found: "${community.name}" with ${community._count.listings} listings`)

  const listings = await prisma.listing.findMany({
    where: { communityId: community.id },
    select: { id: true },
  })
  const ids = listings.map((l) => l.id)

  const ph = await prisma.priceHistory.deleteMany({ where: { listingId: { in: ids } } })
  console.log(`Deleted ${ph.count} price history records`)

  const dl = await prisma.listing.deleteMany({ where: { communityId: community.id } })
  console.log(`Deleted ${dl.count} listings`)

  await prisma.community.delete({ where: { id: community.id } })
  console.log("Deleted community record")

  await prisma.$disconnect()
  console.log("Done.")
}

cleanup().catch((e) => { console.error(e); process.exit(1) })
