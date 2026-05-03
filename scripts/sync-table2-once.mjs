/**
 * sync-table2-once.mjs
 *
 * ONE-TIME script: reconciles Google Sheet Table 2 with actual DB changes
 * since the scrapers started (March 28, 2026).
 *
 * Logic (mirrors what the sheet writer would have written in real-time):
 *
 *   sold_delta   = homes with soldAt  >= SINCE  (address NOT NULL)
 *   forSale_delta= homes with firstDetected >= SINCE (address NOT NULL)
 *                - homes with soldAt  >= SINCE  (address NOT NULL)
 *
 *   Explanation:
 *     • Each home first detected after SINCE triggered: forSale +1
 *     • Each home that went sold after SINCE triggered:  sold +1, forSale -1
 *     Net: forSale_delta = new_homes - sold_homes
 *
 * Homes detected on the initial scrape (March 27) were already in Table 2 —
 * SINCE = March 28 avoids double-counting them.
 *
 * Run: node scripts/sync-table2-once.mjs
 */

import { createSign } from "crypto"
import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require    = createRequire(import.meta.url)
const __dirname  = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.replace(/\r/, "").trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 0) continue
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "")
    if (k && !process.env[k]) process.env[k] = v
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
const SCOPE       = "https://www.googleapis.com/auth/spreadsheets"
const SINCE       = new Date("2026-03-28T00:00:00Z") // day after initial scrape

const BUILDER_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
}

// ── Google Sheets auth ─────────────────────────────────────────────────────────

async function getToken() {
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  const now = Math.floor(Date.now() / 1000)
  const hdr = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  })).toString("base64url")
  const input = `${hdr}.${pay}`
  const sign  = createSign("RSA-SHA256")
  sign.update(input)
  const sig = sign.sign(sa.private_key.replace(/\\n/g, "\n"), "base64url")
  const jwt = `${input}.${sig}`

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── Sheet read / write ─────────────────────────────────────────────────────────

async function readRows(token, tabName) {
  const range = encodeURIComponent(`${tabName}!A1:H300`)
  const res   = await fetch(`${SHEETS_BASE}/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Read failed: ${res.status} for "${tabName}"`)
  const data = await res.json()
  return data.values ?? []
}

async function writeRow(token, tabName, rowNumber, sold, forSale, future, total) {
  const range = encodeURIComponent(`${tabName}!E${rowNumber}:H${rowNumber}`)
  const res   = await fetch(
    `${SHEETS_BASE}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[sold, forSale, future, total]] }),
    },
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Write failed at row ${rowNumber}: ${err}`)
  }
  return (await res.json()).updatedCells
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70))
  console.log(` Table 2 One-Time Sync — ${new Date().toISOString()}`)
  console.log(` Counting DB changes since ${SINCE.toISOString()}`)
  console.log("=".repeat(70))

  const token = await getToken()
  console.log("  ✓ Authenticated\n")

  // ── Query DB for all changes since SINCE ─────────────────────────────────────

  // New real listings first detected after SINCE (both active and sold)
  const newListings = await prisma.listing.findMany({
    where: { address: { not: null }, firstDetected: { gte: SINCE } },
    include: { community: { include: { builder: { select: { name: true } } } } },
  })

  // Real listings that went sold after SINCE
  const soldListings = await prisma.listing.findMany({
    where: { address: { not: null }, soldAt: { gte: SINCE } },
    include: { community: { include: { builder: { select: { name: true } } } } },
  })

  console.log(`  DB: ${newListings.length} new listings since ${SINCE.toLocaleDateString()}`)
  console.log(`  DB: ${soldListings.length} sold listings since ${SINCE.toLocaleDateString()}\n`)

  // ── Build per-community deltas ────────────────────────────────────────────────

  const deltas = {}  // "BuilderName|CommunityName" → { sold, forSale }

  for (const l of newListings) {
    const key = `${l.community.builder.name}|${l.community.name}`
    if (!deltas[key]) deltas[key] = { builder: l.community.builder.name, community: l.community.name, sold: 0, forSale: 0 }
    deltas[key].forSale += 1   // each new listing entered the for-sale pool
  }

  for (const l of soldListings) {
    const key = `${l.community.builder.name}|${l.community.name}`
    if (!deltas[key]) deltas[key] = { builder: l.community.builder.name, community: l.community.name, sold: 0, forSale: 0 }
    deltas[key].sold    += 1   // went sold
    deltas[key].forSale -= 1   // left the for-sale pool
  }

  const changes = Object.values(deltas).filter(d => d.sold !== 0 || d.forSale !== 0)

  if (changes.length === 0) {
    console.log("  No changes to apply. Table 2 is already up to date.")
    return
  }

  console.log(`  ${changes.length} communities need updating:\n`)

  // ── Apply deltas to Sheet Table 2 ─────────────────────────────────────────────

  let totalUpdated = 0

  // Group by builder tab
  const byBuilder = {}
  for (const c of changes) {
    if (!byBuilder[c.builder]) byBuilder[c.builder] = []
    byBuilder[c.builder].push(c)
  }

  for (const [builderName, comms] of Object.entries(byBuilder)) {
    const tabName = BUILDER_TABS[builderName]
    if (!tabName) { console.warn(`  SKIP: Unknown builder "${builderName}"`); continue }

    console.log(`  ── ${builderName} (${tabName}) ──`)
    const rows = await readRows(token, tabName)

    for (const { community, sold: dSold, forSale: dForSale } of comms) {
      // Find row
      let foundIndex = -1
      let current = null
      for (let i = 0; i < rows.length; i++) {
        const row  = rows[i]
        if ((row[0] ?? "").trim() === "Table 3") break
        if ((row[3] ?? "").trim().toLowerCase() === community.toLowerCase()) {
          foundIndex = i
          current = {
            sold:    parseInt(row[4] ?? "0") || 0,
            forSale: parseInt(row[5] ?? "0") || 0,
            future:  parseInt(row[6] ?? "0") || 0,
          }
          break
        }
      }

      if (foundIndex === -1 || !current) {
        console.warn(`    SKIP "${community}" — not found in Table 2`)
        continue
      }

      const newSold    = Math.max(0, current.sold    + dSold)
      const newForSale = Math.max(0, current.forSale + dForSale)
      const newFuture  = current.future
      const newTotal   = newSold + newForSale + newFuture

      const sheetRow = foundIndex + 1
      const cells    = await writeRow(token, tabName, sheetRow, newSold, newForSale, newFuture, newTotal)

      console.log(
        `    ✓ "${community}" row ${sheetRow}: ` +
        `sold ${current.sold}→${newSold} (${dSold >= 0 ? "+" : ""}${dSold}), ` +
        `forSale ${current.forSale}→${newForSale} (${dForSale >= 0 ? "+" : ""}${dForSale}), ` +
        `total →${newTotal} [${cells} cells]`
      )
      totalUpdated++
    }
    console.log()
  }

  console.log("=".repeat(70))
  console.log(` ✓ Done — ${totalUpdated} communities updated in Table 2`)
  console.log("=".repeat(70))
}

main()
  .catch(err => { console.error("FAILED:", err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
