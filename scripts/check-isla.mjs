import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\r\n]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
const comm = await prisma.community.findFirst({ where: { name: "Isla at Luna Park" } })
const total = await prisma.listing.count({ where: { communityId: comm.id } })
const sample = await prisma.listing.findMany({ where: { communityId: comm.id }, select: { address: true, lotNumber: true, status: true }, take: 10 })
const nullAddr = await prisma.listing.count({ where: { communityId: comm.id, address: null } })
console.log("total:", total, "| null-address:", nullAddr)
console.log("sample:", JSON.stringify(sample, null, 2))
await prisma.$disconnect()
