/**
 * migrate-lot-numbers.mjs
 *
 * One-time migration: update all existing listing lotNumbers from bare values
 * (e.g. "42") to composite community+lot format (e.g. "Isla42").
 *
 * Safe to run multiple times — skips listings that are already migrated or
 * have placeholder lotNumbers (sold-N, avail-N, future-N).
 *
 * Run: node scripts/migrate-lot-numbers.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("../node_modules/@prisma/client")
const prisma = new PrismaClient()

const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

async function main() {
  console.log("=".repeat(60))
  console.log("Lot Number Migration — bare → communityName+lot")
  console.log("=".repeat(60))

  // Fetch all communities with their listings that have non-null lotNumbers
  const communities = await prisma.community.findMany({
    select: {
      id:   true,
      name: true,
      listings: {
        where: { lotNumber: { not: null } },
        select: { id: true, lotNumber: true },
      },
    },
  })

  let totalUpdated  = 0
  let totalSkipped  = 0

  for (const community of communities) {
    const prefix = community.name.replace(/\s+/g, "")
    const toUpdate = []

    for (const listing of community.listings) {
      const lot = listing.lotNumber
      if (!lot) continue

      // Skip placeholders
      if (PLACEHOLDER_RE.test(lot)) {
        totalSkipped++
        continue
      }

      // Skip already-migrated (starts with community prefix)
      if (lot.startsWith(prefix)) {
        totalSkipped++
        continue
      }

      toUpdate.push({ id: listing.id, newLotNumber: compositeKey(community.name, lot) })
    }

    if (toUpdate.length === 0) continue

    console.log(`\n${community.name} — ${toUpdate.length} lot(s) to migrate`)
    for (const { id, newLotNumber } of toUpdate) {
      const old = community.listings.find(l => l.id === id)?.lotNumber
      console.log(`  ${old} → ${newLotNumber}`)
      await prisma.listing.update({
        where: { id },
        data:  { lotNumber: newLotNumber },
      })
      totalUpdated++
    }
  }

  await prisma.$disconnect()

  console.log("\n" + "=".repeat(60))
  console.log(`Migration complete — Updated: ${totalUpdated} | Skipped: ${totalSkipped}`)
  console.log("=".repeat(60))
}

main().catch(err => {
  console.error("Fatal:", err)
  prisma.$disconnect()
  process.exit(1)
})
