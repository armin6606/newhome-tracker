import { prisma } from "../lib/db"
async function main() {
  const b = await prisma.builder.findFirst({ where: { name: "Melia Homes" } })
  if (!b) return
  const comms = await prisma.community.findMany({ where: { builderId: b.id }, select: { name: true, url: true, city: true } })
  comms.forEach(c => console.log(`${c.name} | ${c.city} | ${c.url}`))
}
main().catch(console.error).finally(() => prisma.$disconnect())
