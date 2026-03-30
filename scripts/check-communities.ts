import { prisma } from "@/lib/db"

async function main() {
  const comms = await prisma.community.findMany({ 
    where: { OR: [{ name: { contains: "Elm" } }, { name: { contains: "Birch" } }] },
    include: { builder: { select: { name: true } }, _count: { select: { listings: true } } }
  })
  comms.forEach(c => {
    console.log(`id=${c.id} name="${c.name}" builder=${c.builder.name} listings=${c._count.listings} excluded=${c.excluded}`)
  })
  await prisma.$disconnect()
}
main().catch(console.error)
