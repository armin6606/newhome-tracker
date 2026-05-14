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

// Find all KB Home listings marked sold in the last 48 hours
const wronglySold = await prisma.listing.findMany({
  where: {
    community: { builder: { name: "KB Home" } },
    status: "sold",
    soldAt: { gte: cutoff }
  },
  include: { community: { select: { name: true } } }
})

console.log(`Found ${wronglySold.length} KB Home listings to restore to active`)

if (wronglySold.length === 0) {
  console.log("Nothing to restore.")
  await prisma.$disconnect()
  process.exit(0)
}

// Restore them all to active and clear soldAt
const ids = wronglySold.map(l => l.id)
const result = await prisma.listing.updateMany({
  where: { id: { in: ids } },
  data: { status: "active", soldAt: null }
})

console.log(`✅ Restored ${result.count} listings back to active`)

// Show breakdown
const byCommunity = {}
for (const l of wronglySold) {
  const cn = l.community.name
  byCommunity[cn] = (byCommunity[cn] || 0) + 1
}
for (const [k, v] of Object.entries(byCommunity)) console.log(`  ${k}: ${v} restored`)

await prisma.$disconnect()
