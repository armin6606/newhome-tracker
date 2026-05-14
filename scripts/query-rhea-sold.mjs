import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()
const rows = await prisma.listing.findMany({
  where: { status: "sold", community: { name: { contains: "Rhea", mode: "insensitive" } } },
  select: { address: true, lotNumber: true, floorPlan: true },
  orderBy: { lotNumber: "asc" }
})
console.log(JSON.stringify(rows, null, 2))
await prisma.$disconnect()
