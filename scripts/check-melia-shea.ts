import { prisma } from "../lib/db"

async function main() {
  for (const builderName of ["Melia Homes", "Shea Homes"]) {
    const b = await prisma.builder.findFirst({ where: { name: builderName } })
    if (!b) { console.log(`${builderName}: not in DB`); continue }
    const comms = await prisma.community.findMany({
      where: { builderId: b.id },
      include: { _count: { select: { listings: true } } },
    })
    console.log(`\n${builderName} (${comms.length} communities):`)
    comms.forEach(c => console.log(`  ${c.name}: ${c._count.listings} listings`))
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
