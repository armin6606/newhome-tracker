import { prisma } from "../lib/db"

async function main() {
  const community = await prisma.community.findFirst({
    where: { name: "Torrey" },
  })
  if (!community) { console.log("Torrey not found"); return }

  const listings = await prisma.listing.findMany({
    where: { communityId: community.id, status: { not: "removed" } },
    orderBy: { lotNumber: "asc" },
    select: { id: true, address: true, lotNumber: true, status: true, firstDetected: true },
  })

  // Find any lotNumbers that appear more than once
  const byLotNum = new Map<string, typeof listings>()
  for (const l of listings) {
    if (!l.lotNumber) continue
    if (!byLotNum.has(l.lotNumber)) byLotNum.set(l.lotNumber, [])
    byLotNum.get(l.lotNumber)!.push(l)
  }

  const dupes = [...byLotNum.entries()].filter(([, ls]) => ls.length > 1)
  console.log(`Total listings: ${listings.length}`)
  console.log(`Duplicate lotNumbers: ${dupes.length}`)
  dupes.forEach(([lot, ls]) => {
    console.log(`  lotNumber=${lot}:`)
    ls.forEach(l => console.log(`    id=${l.id} address="${l.address}" status=${l.status}`))
  })

  // Also show any with null lotNumber
  const nullLot = listings.filter(l => !l.lotNumber)
  console.log(`\nListings with null lotNumber: ${nullLot.length}`)
  nullLot.slice(0, 5).forEach(l => console.log(`  id=${l.id} address="${l.address}" status=${l.status} detected=${l.firstDetected.toISOString().slice(0,10)}`))
}

main().catch(console.error).finally(() => prisma.$disconnect())
