/**
 * snapshot-11pm.mjs
 * 11 PM daily — saves pre-scrape state to logs/nightly-snapshot.json
 *
 * Captures:
 *   - forSaleCount  : real active listings (not placeholders)
 *   - communityCards: placeholder-based counts per community
 *   - table2        : Sheet Table 2 counts per builder/community
 *
 * Run:      node scripts/snapshot-11pm.mjs
 * Schedule: Windows Task Scheduler → 11:00 PM daily
 */

import { createRequire } from "module"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require    = createRequire(import.meta.url)
const __dirname  = dirname(fileURLToPath(import.meta.url))

// Load .env.local
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

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const BUILDER_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

// ── Fetch Table 2 from a sheet tab ────────────────────────────────────────────

async function fetchTable2(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  try {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) return {}
    const rows = parseCSV(await res.text())
    const counts = {}
    for (const row of rows) {
      const name = row[3]?.trim()
      if (!name || name === "Table 2 Community" || name === "Table 2" || name === "Community") continue
      if (row[0]?.trim() === "Table 3") break
      const sold    = parseInt(row[4]) || 0
      const forSale = parseInt(row[5]) || 0
      const future  = parseInt(row[6]) || 0
      const total   = parseInt(row[7]) || 0
      if (sold === 0 && forSale === 0 && future === 0 && total === 0) continue
      counts[name] = { sold, forSale, future, total }
    }
    return counts
  } catch {
    return {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log(` 11 PM Snapshot — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  // 1. For-sale count — real active listings (exclude avail- placeholders)
  const forSaleCount = await prisma.listing.count({
    where: {
      status:  "active",
      address: { not: null },
    },
  })
  console.log(`  For-sale listings: ${forSaleCount}`)

  // 2. Community card counts from placeholders (address IS NULL)
  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { name: true } },
      listings: {
        where:  { address: null, status: { not: "removed" } },
        select: { status: true },
      },
    },
  })

  const communityCards = {}
  for (const c of communities) {
    const ph = c.listings
    communityCards[c.name] = {
      builder: c.builder.name,
      active:  ph.filter(l => l.status === "active").length,
      sold:    ph.filter(l => l.status === "sold").length,
      future:  ph.filter(l => l.status === "future").length,
      total:   ph.length,
    }
  }
  console.log(`  Community cards captured: ${Object.keys(communityCards).length}`)

  // 3. Sheet Table 2 — fetch all builder tabs
  console.log("\n  Fetching Sheet Table 2…")
  const table2 = {}
  for (const [builderName, tabName] of Object.entries(BUILDER_TABS)) {
    table2[builderName] = await fetchTable2(tabName)
    const count = Object.keys(table2[builderName]).length
    console.log(`    ${builderName}: ${count} communities`)
  }

  // 4. Write snapshot
  const snapshot = {
    timestamp:      new Date().toISOString(),
    forSaleCount,
    communityCards,
    table2,
  }

  const outPath = resolve(__dirname, "../logs/nightly-snapshot.json")
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8")

  // Also save a dated copy so history is preserved
  const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const archiveDir = resolve(__dirname, "../logs/snapshots")
  mkdirSync(archiveDir, { recursive: true })
  const archivePath = resolve(archiveDir, `snapshot-${dateStr}.json`)
  writeFileSync(archivePath, JSON.stringify(snapshot, null, 2), "utf8")
  console.log(`\n  ✓ Snapshot saved to ${outPath}`)
  console.log(`  ✓ Archive saved to  ${archivePath}`)
  console.log("=".repeat(60))
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
