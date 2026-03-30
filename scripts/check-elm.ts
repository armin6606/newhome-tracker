import { prisma } from "@/lib/db"

async function main() {
  const stats = await prisma.listing.groupBy({
    by: ["status"],
    where: { community: { name: "Elm at GPN" } },
    _count: true,
  })
  console.log("Elm at GPN by status:")
  stats.forEach(s => console.log(" ", s.status, "=", s._count))

  const total = await prisma.listing.count({ where: { community: { name: "Elm at GPN" } } })
  console.log("Total in DB:", total)

  // Check for any duplicate addresses
  const all = await prisma.listing.findMany({
    where: { community: { name: "Elm at GPN" } },
    select: { id: true, address: true, status: true, lotNumber: true },
    orderBy: { address: "asc" }
  })

  const seen = new Map<string, number[]>()
  for (const l of all) {
    const key = l.address ?? ""
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key)!.push(l.id)
  }

  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1)
  if (dupes.length > 0) {
    console.log(`\nDuplicate addresses (${dupes.length}):`)
    dupes.forEach(([addr, ids]) => console.log(" ", addr, "→ ids:", ids.join(", ")))
  } else {
    console.log("\nNo duplicate addresses")
  }

  await prisma.$disconnect()
}
main().catch(console.error)
