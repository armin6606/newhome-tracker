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

const placeholders = await prisma.listing.findMany({
  where: {
    community: { builder: { name: "KB Home" } },
    OR: [
      { address: { startsWith: "avail-" } },
      { address: { startsWith: "future-" } },
      { address: { startsWith: "sold-" } },
    ]
  },
  include: { community: { select: { name: true } } }
})

const realCount = await prisma.listing.count({
  where: {
    community: { builder: { name: "KB Home" } },
    NOT: {
      OR: [
        { address: { startsWith: "avail-" } },
        { address: { startsWith: "future-" } },
        { address: { startsWith: "sold-" } },
      ]
    }
  }
})

console.log(`Placeholder rows : ${placeholders.length}`)
console.log(`Real listing rows: ${realCount}`)

const byComm = {}
for (const p of placeholders) {
  const cn = p.community.name
  if (!byComm[cn]) byComm[cn] = { avail: 0, future: 0, sold: 0 }
  if (p.address.startsWith("avail-"))   byComm[cn].avail++
  else if (p.address.startsWith("future-")) byComm[cn].future++
  else if (p.address.startsWith("sold-"))   byComm[cn].sold++
}

console.log("\nPlaceholder breakdown by community:")
for (const [k, v] of Object.entries(byComm)) {
  console.log(`  ${k}: avail=${v.avail} future=${v.future} sold=${v.sold}`)
}

await prisma.$disconnect()
