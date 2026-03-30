import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const rows = await prisma.listing.findMany({
  select: { floorPlan: true, floors: true },
  where: { status: 'active' },
  distinct: ['floorPlan']
})
rows.sort((a,b) => (a.floorPlan||'').localeCompare(b.floorPlan||''))
rows.forEach(r => console.log((r.floors ?? 'NULL') + ' | ' + r.floorPlan))
await prisma.$disconnect()
