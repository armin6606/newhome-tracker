import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const rows = await prisma.listing.findMany({
  where: { status: 'active' },
  select: { address: true, floorPlan: true, floors: true, hoaFees: true, taxes: true, moveInDate: true },
  orderBy: { id: 'asc' },
  take: 10
})
rows.forEach(r => console.log(
  `floors=${r.floors ?? 'NULL'} | hoa=${r.hoaFees ?? 'NULL'} | tax=${r.taxes ?? 'NULL'} | move=${r.moveInDate ?? 'NULL'} | plan=${r.floorPlan} | addr=${r.address}`
))
await prisma.$disconnect()
