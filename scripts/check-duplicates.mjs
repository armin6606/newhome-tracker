/**
 * check-duplicates.mjs
 *
 * Runs daily at 5 AM via Windows Task Scheduler.
 * Checks all listings for duplicates within each community:
 *   - Same lotNumber (non-placeholder) in same community
 *   - Same address in same community
 * Writes findings to logs/duplicate-check.log
 *
 * Run: node scripts/check-duplicates.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "fs"
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

const LOG_FILE       = resolve(__dirname, "../logs/duplicate-check.log")
const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/

function log(msg) {
  console.log(msg)
  appendFileSync(LOG_FILE, msg + "\n")
}

async function main() {
  const timestamp = new Date().toISOString()

  // Write a separator for this run
  appendFileSync(LOG_FILE, "\n" + "=".repeat(60) + "\n")
  log(`Duplicate Check — ${timestamp}`)
  log("=".repeat(60))

  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { name: true } },
      listings: {
        where: { status: { not: "removed" } },
        select: { id: true, address: true, lotNumber: true, status: true },
      },
    },
    orderBy: { name: "asc" },
  })

  let totalDuplicates = 0

  for (const community of communities) {
    const { listings } = community
    const issues = []

    // ── Check duplicate lotNumbers ─────────────────────────────────────────
    const lotMap = new Map()
    for (const l of listings) {
      if (!l.lotNumber) continue
      if (PLACEHOLDER_RE.test(l.lotNumber)) continue
      if (!lotMap.has(l.lotNumber)) lotMap.set(l.lotNumber, [])
      lotMap.get(l.lotNumber).push(l)
    }
    for (const [lotNum, dupes] of lotMap) {
      if (dupes.length > 1) {
        issues.push({
          reason: "Duplicate lotNumber",
          value:  lotNum,
          ids:    dupes.map(l => l.id),
          statuses: dupes.map(l => l.status),
        })
      }
    }

    // ── Check duplicate addresses ──────────────────────────────────────────
    const addrMap = new Map()
    for (const l of listings) {
      if (!l.address) continue
      const key = l.address.toLowerCase().trim()
      if (!addrMap.has(key)) addrMap.set(key, [])
      addrMap.get(key).push(l)
    }
    for (const [addr, dupes] of addrMap) {
      if (dupes.length > 1) {
        issues.push({
          reason: "Duplicate address",
          value:  addr,
          ids:    dupes.map(l => l.id),
          statuses: dupes.map(l => l.status),
        })
      }
    }

    if (issues.length > 0) {
      log(`\n${community.builder.name} — ${community.name}`)
      for (const issue of issues) {
        log(`  [${issue.reason}] "${issue.value}"`)
        log(`    IDs: ${issue.ids.join(", ")}`)
        log(`    Statuses: ${issue.statuses.join(", ")}`)
        totalDuplicates++
      }
    }
  }

  if (totalDuplicates === 0) {
    log("\n✓ No duplicates found across all communities.")
  } else {
    log(`\n⚠ Total duplicate groups found: ${totalDuplicates}`)
  }

  log("=".repeat(60))

  await prisma.$disconnect()
  return totalDuplicates
}

main().catch(err => {
  appendFileSync(LOG_FILE, `\nFATAL ERROR: ${err.message}\n`)
  console.error("Fatal:", err)
  prisma.$disconnect()
  process.exit(1)
})
