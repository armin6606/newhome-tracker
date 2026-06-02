import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const lot = process.argv[2] || process.env.LOT_NUMBER || "104"

const rows = await prisma.listing.findMany({
  where: {
    AND: [
      {
        OR: [
          { lotNumber: { contains: lot } },
          { address: { contains: lot } },
          { sourceUrl: { contains: lot } },
        ],
      },
      {
        OR: [
          { floorPlan: { contains: "Rhea", mode: "insensitive" } },
          { address: { contains: "Rhea", mode: "insensitive" } },
          { sourceUrl: { contains: "rhea", mode: "insensitive" } },
          { community: { name: { contains: "Rhea", mode: "insensitive" } } },
        ],
      },
    ],
  },
  select: {
    id: true,
    address: true,
    lotNumber: true,
    floorPlan: true,
    status: true,
    currentPrice: true,
    lastUpdated: true,
    soldAt: true,
    sourceUrl: true,
    community: {
      select: {
        name: true,
        builder: { select: { name: true } },
      },
    },
  },
  orderBy: { id: "desc" },
  take: 20,
})

console.log(`RHEA${lot} matches: ${rows.length}`)
for (const row of rows) {
  console.log(JSON.stringify(row))
}

await prisma.$disconnect()
