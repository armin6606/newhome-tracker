/**
 * sync-community-counts.mjs
 * 2 AM daily — reads Table 2 from every builder's Google Sheet tab
 * and syncs community card counts (placeholder lots) in New Key.
 *
 * This script does NOT touch real listings (those have addresses).
 * It only manages null-address placeholder lots that drive the pie chart.
 *
 * Run:      node scripts/sync-community-counts.mjs
 * Schedule: Windows Task Scheduler → "NewKey Community Count Sync" → 2:00 AM daily
 */

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const SHEET_BASE    = "https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/export?format=csv&gid="

// Add new builder tabs here as they are created
const BUILDER_TABS = [
  { builder: "Toll Brothers", websiteUrl: "https://www.tollbrothers.com", gid: "0",          city: "Irvine" },
  { builder: "Lennar",        websiteUrl: "https://www.lennar.com",       gid: "1235396983", city: "Irvine" },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Read Table 2 from a sheet tab ─────────────────────────────────────────────

async function readTable2(gid) {
  const res  = await fetch(SHEET_BASE + gid, { redirect: "follow" })
  const rows = parseCSV(await res.text())

  const communities = []
  let inTable2 = false

  for (const row of rows) {
    if (row[3] === "Table 2")                             { inTable2 = true;  continue }
    if (inTable2 && (row[0] === "Table 3" || row[3] === "Table 3")) { inTable2 = false; continue }
    if (!inTable2)                                        continue
    if (row[3] === "Community" && row[4] === "Sold Homes") continue
    if (!row[3])                                          continue

    communities.push({
      name:    row[3],
      sold:    parseInt(row[4]) || 0,
      forSale: parseInt(row[5]) || 0,
      future:  parseInt(row[6]) || 0,
      total:   parseInt(row[7]) || 0,
    })
  }

  return communities
}

// ── POST placeholder lots for a community ─────────────────────────────────────

async function syncCounts(builder, websiteUrl, city, community) {
  const { name, sold, forSale, future } = community

  const listings = [
    ...Array.from({ length: sold   }, (_, i) => ({ lotNumber: `sold-${i+1}`,   status: "sold"   })),
    ...Array.from({ length: forSale}, (_, i) => ({ lotNumber: `avail-${i+1}`,  status: "active" })),
    ...Array.from({ length: future }, (_, i) => ({ lotNumber: `future-${i+1}`, status: "future" })),
  ]

  const res = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify({
      builder:           { name: builder, websiteUrl },
      community:         { name, city, state: "CA" },
      listings,
      clearPlaceholders: true,
    }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(`Ingest failed (${res.status}): ${JSON.stringify(result)}`)
  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log(` New Key Community Count Sync — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  let totalSuccess = 0
  let totalFail    = 0

  for (const { builder, websiteUrl, gid, city } of BUILDER_TABS) {
    console.log(`\n── ${builder} (gid=${gid})`)

    let communities
    try {
      communities = await readTable2(gid)
      console.log(`   ${communities.length} community(s) in Table 2`)
    } catch (err) {
      console.error(`   ✗ Sheet read failed: ${err.message}`)
      totalFail++
      continue
    }

    for (const community of communities) {
      const { name, sold, forSale, future, total } = community
      try {
        const result = await syncCounts(builder, websiteUrl, city, community)
        const changed = result.created + result.updated
        console.log(`   ✓ ${name}: ${sold} sold | ${forSale} for sale | ${future} future | ${total} total${changed ? ` (${changed} updated)` : ""}`)
        totalSuccess++
      } catch (err) {
        console.error(`   ✗ ${name}: ${err.message}`)
        totalFail++
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("\n" + "=".repeat(60))
  console.log(` Summary: ${totalSuccess} succeeded | ${totalFail} failed | ${elapsed}s`)
  console.log("=".repeat(60))

  if (totalSuccess === 0) process.exit(1)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
