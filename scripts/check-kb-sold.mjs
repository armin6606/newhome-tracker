import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.replace(/\r/, "").split("=")
    if (k && !k.startsWith("#") && v.length)
      process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

const soldTotal = await prisma.listing.count({
  where: { community: { builder: { name: "KB Home" } }, status: "sold" }
})
const activeTotal = await prisma.listing.count({
  where: { community: { builder: { name: "KB Home" } }, status: "active" }
})
const recentlySold = await prisma.listing.findMany({
  where: { community: { builder: { name: "KB Home" } }, status: "sold", soldAt: { gte: cutoff } },
  include: { community: { select: { name: true } } },
  orderBy: { soldAt: "desc" }
})

console.log("KB Home — Active listings :", activeTotal)
console.log("KB Home — Sold (total)    :", soldTotal)
console.log("KB Home — Sold last 48h   :", recentlySold.length)

const byCommunity = {}
for (const l of recentlySold) {
  const cn = l.community.name
  byCommunity[cn] = (byCommunity[cn] || 0) + 1
}
console.log("\nBreakdown by community:")
for (const [k, v] of Object.entries(byCommunity)) console.log(`  ${k}: ${v}`)

if (recentlySold.length > 0) {
  const times = [...new Set(recentlySold.map(l => l.soldAt?.toISOString().substring(0, 16)))]
  console.log("\nSold-at timestamps (unique, minute precision):")
  times.slice(0, 10).forEach(t => console.log(" ", t))
}

await prisma.$disconnect()
