import { prisma } from "../lib/db"

async function main() {
  const community = await prisma.community.findFirst({ where: { name: "Torrey" } })
  if (!community) { console.log("Torrey not found"); return }

  // ALL listings including removed
  const all = await prisma.listing.findMany({
    where: { communityId: community.id },
    select: { id: true, address: true, lotNumber: true, status: true },
  })
  const removed = all.filter(l => l.status === "removed")
  const active  = all.filter(l => l.status !== "removed")
  console.log(`Total rows (incl removed): ${all.length}`)
  console.log(`Active: ${active.length}  |  Removed: ${removed.length}`)

  // Removed listings that have a lotNumber
  const removedWithLot = removed.filter(l => l.lotNumber)
  console.log(`Removed with lotNumber: ${removedWithLot.length}`)
  removedWithLot.slice(0, 10).forEach(l =>
    console.log(`  id=${l.id} lotNumber=${l.lotNumber} address="${l.address}"`)
  )

  // Active listings whose lotNumber also appears in a removed listing (the real conflict source)
  const removedLotSet = new Set(removedWithLot.map(l => l.lotNumber!))
  const crossConflicts = active.filter(l => l.lotNumber && removedLotSet.has(l.lotNumber))
  console.log(`\nActive listings sharing a lotNumber with a removed row: ${crossConflicts.length}`)
  crossConflicts.forEach(l =>
    console.log(`  id=${l.id} lotNumber=${l.lotNumber} address="${l.address}" status=${l.status}`)
  )
}

main().catch(console.error).finally(() => prisma.$disconnect())
