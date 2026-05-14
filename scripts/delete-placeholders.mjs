import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

const deleted = await prisma.$executeRaw`
  DELETE FROM "Listing"
  WHERE "lotNumber" ~ '^(sold|avail|future)-[0-9]+$'
`

console.log(`Deleted ${deleted} placeholder rows`)
await prisma.$disconnect()
