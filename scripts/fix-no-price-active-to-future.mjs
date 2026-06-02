/**
 * Move no-price or invalid-price active listings to future.
 *
 * Site rule: "for sale" requires a real published price.
 * Run: npx tsx scripts/fix-no-price-active-to-future.mjs
 */

import { createRequire } from "module"
import { existsSync, readFileSync } from "fs"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.replace(/\r/, "").split("=")
    if (k && !k.startsWith("#") && v.length) {
      process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "")
    }
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
const PRICE_MIN = 200_000

async function main() {
  const rows = await prisma.listing.findMany({
    where: {
      status: "for sale",
      OR: [
        { currentPrice: null },
        { currentPrice: { lt: PRICE_MIN } },
      ],
    },
    select: {
      id: true,
      address: true,
      lotNumber: true,
      currentPrice: true,
      community: {
        select: {
          name: true,
          builder: { select: { name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  })

  if (rows.length === 0) {
    console.log("No no-price or invalid-price active listings found.")
    return
  }

  const byBuilder = rows.reduce((acc, row) => {
    const builder = row.community.builder.name
    acc[builder] = (acc[builder] ?? 0) + 1
    return acc
  }, {})

  console.log(`Moving ${rows.length} no-price or invalid-price active listings to future.`)
  console.log(JSON.stringify(byBuilder, null, 2))
  console.log("Examples:")
  for (const row of rows.slice(0, 20)) {
    console.log(`- ${row.community.builder.name} / ${row.community.name} / Lot ${row.lotNumber ?? "?"} / ${row.address ?? "no address"} / price ${row.currentPrice ?? "none"}`)
  }

  const result = await prisma.listing.updateMany({
    where: {
      status: "for sale",
      OR: [
        { currentPrice: null },
        { currentPrice: { lt: PRICE_MIN } },
      ],
    },
    data: {
      status: "future",
      currentPrice: null,
      pricePerSqft: null,
      soldAt: null,
    },
  })

  console.log(`Updated ${result.count} listings.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
