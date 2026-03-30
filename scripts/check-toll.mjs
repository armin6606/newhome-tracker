import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\r\n]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })

const builder = await prisma.builder.findUnique({ where: { name: "Toll Brothers" } })
const comms = await prisma.community.findMany({
  where: { builderId: builder.id },
  include: { _count: { select: { listings: true } } },
})

for (const c of comms) {
  const placeholders = await prisma.listing.count({
    where: { communityId: c.id, lotNumber: { in: [] } }
  })
  const sample = await prisma.listing.findMany({
    where: { communityId: c.id },
    select: { address: true, lotNumber: true, status: true },
    take: 3,
  })
  const nullAddr = await prisma.listing.count({ where: { communityId: c.id, address: null } })
  console.log(`\n${c.name}: ${c._count.listings} total | ${nullAddr} null-address`)
  console.log("sample:", JSON.stringify(sample))
}

await prisma.$disconnect()
