/**
 * fix-lennar-counts.mjs
 * One-time fix: clears all listings for every Lennar community and re-seeds
 * correct placeholder counts from Google Sheet Table 2.
 *
 * Run once after a bad scraper run messes up community counts:
 *   cd "C:\New Key" && node scripts/fix-lennar-counts.mjs
 */

import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"

// ── Load .env.local ────────────────────────────────────────────────────────────
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\r\n]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = process.env.INGEST_SECRET
const SHEET_BASE    = "https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/export?format=csv&gid="
const LENNAR_GID    = "1235396983"

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line) {
      if (ch === '"')                inQ = !inQ
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    cells.push(cur.trim())
    return cells
  })
}

async function readLennarTable2() {
  const res  = await fetch(SHEET_BASE + LENNAR_GID, { redirect: "follow" })
  const rows = parseCSV(await res.text())
  const communities = []
  let inTable2 = false
  for (const row of rows) {
    if (row[3] === "Table 2")                                         { inTable2 = true;  continue }
    if (inTable2 && (row[0] === "Table 3" || row[3] === "Table 3"))   { inTable2 = false; continue }
    if (!inTable2)                                                    continue
    if (row[3] === "Community" && row[4] === "Sold Homes")            continue
    if (!row[3])                                                      continue
    communities.push({
      name:    row[3],
      sold:    parseInt(row[4]) || 0,
      forSale: parseInt(row[5]) || 0,
      future:  parseInt(row[6]) || 0,
    })
  }
  return communities
}

async function main() {
  console.log("=".repeat(60))
  console.log(` Lennar Count Fix — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  // 1. Find all Lennar communities
  const builder = await prisma.builder.findUnique({ where: { name: "Lennar" } })
  if (!builder) { console.log("No Lennar builder in DB — nothing to fix."); return }

  const comms = await prisma.community.findMany({
    where: { builderId: builder.id },
    include: { _count: { select: { listings: true } } },
  })

  console.log(`\nLennar communities in DB (${comms.length}):`)
  comms.forEach(c => console.log(`  • ${c.name}: ${c._count.listings} listings`))

  // 2. Delete all price history, then listings, then bad communities
  console.log("\nClearing all Lennar data…")
  const commIds = comms.map(c => c.id)
  const listings = await prisma.listing.findMany({ where: { communityId: { in: commIds } }, select: { id: true } })
  const listingIds = listings.map(l => l.id)

  if (listingIds.length > 0) {
    const { count: phCount } = await prisma.priceHistory.deleteMany({ where: { listingId: { in: listingIds } } })
    console.log(`  ✓ Deleted ${phCount} price history records`)
    const { count: lCount } = await prisma.listing.deleteMany({ where: { id: { in: listingIds } } })
    console.log(`  ✓ Deleted ${lCount} listings`)
  }

  // Remove communities not in Table 2 (garbage ones like "Type", "Townhome")
  // We'll delete all Lennar communities and let the sync recreate the correct ones
  const { count: cCount } = await prisma.community.deleteMany({ where: { builderId: builder.id } })
  console.log(`  ✓ Deleted ${cCount} communities (will be recreated from Table 2)`)

  // 3. Read correct counts from Table 2
  console.log("\nReading Table 2 from Sheet…")
  const table2 = await readLennarTable2()
  table2.forEach(c => console.log(`  • ${c.name}: sold=${c.sold} | for-sale=${c.forSale} | future=${c.future}`))

  // 4. Re-seed placeholder counts
  console.log("\nSeeding placeholder counts…")
  for (const { name, sold, forSale, future } of table2) {
    const listings = [
      ...Array.from({ length: sold    }, (_, i) => ({ lotNumber: `sold-${i+1}`,   status: "sold"   })),
      ...Array.from({ length: forSale }, (_, i) => ({ lotNumber: `avail-${i+1}`,  status: "active" })),
      ...Array.from({ length: future  }, (_, i) => ({ lotNumber: `future-${i+1}`, status: "future" })),
    ]
    const res    = await fetch(INGEST_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
      body:    JSON.stringify({
        builder:           { name: "Lennar", websiteUrl: "https://www.lennar.com" },
        community:         { name, city: "Irvine", state: "CA" },
        listings,
        clearPlaceholders: true,
      }),
    })
    const result = await res.json()
    if (!res.ok) console.error(`  ✗ ${name}: ${JSON.stringify(result)}`)
    else         console.log(`  ✓ ${name}: ${sold} sold | ${forSale} for-sale | ${future} future (${result.created} inserted)`)
  }

  console.log("\n" + "=".repeat(60))
  console.log(" Done — community card should now show correct counts.")
  console.log("=".repeat(60))
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
