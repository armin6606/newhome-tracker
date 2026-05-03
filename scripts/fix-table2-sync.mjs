/**
 * fix-table2-sync.mjs
 *
 * Corrects the bad sync-table2-once.mjs run.
 *
 * RULE: The only automatic Table 2 change allowed is:
 *   active → sold:  sold +1, forSale -1
 *
 * New listings appearing in DB do NOT increment Table 2 forSale —
 * those homes were already in Table 2 (either as forSale or future).
 *
 * This script reads current sheet state and writes the correct values
 * based purely on DB sold events since March 28.
 */

import { createSign } from "crypto"
import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require    = createRequire(import.meta.url)
const __dirname  = dirname(fileURLToPath(import.meta.url))

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
const SINCE       = new Date("2026-03-28T00:00:00Z")

const BUILDER_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
}

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
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${sig}` }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Token: ${JSON.stringify(data)}`)
  return data.access_token
}

async function readRows(token, tabName) {
  const range = encodeURIComponent(`${tabName}!A1:H300`)
  const res   = await fetch(`${SHEETS_BASE}/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Read failed: ${res.status}`)
  return (await res.json()).values ?? []
}

async function writeRow(token, tabName, rowNumber, sold, forSale, future, total) {
  const range = encodeURIComponent(`${tabName}!E${rowNumber}:H${rowNumber}`)
  const res   = await fetch(`${SHEETS_BASE}/${SHEET_ID}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[sold, forSale, future, total]] }),
  })
  if (!res.ok) throw new Error(`Write failed at row ${rowNumber}: ${await res.text()}`)
  return (await res.json()).updatedCells
}

async function main() {
  console.log("=".repeat(70))
  console.log(` Table 2 Fix — ${new Date().toISOString()}`)
  console.log(` Correct rule: ONLY sold events change Table 2 (sold+1, forSale-1)`)
  console.log("=".repeat(70))

  const token = await getToken()
  console.log("  ✓ Authenticated\n")

  // ONLY count homes that went sold since SINCE — no new listing counting
  const soldListings = await prisma.listing.findMany({
    where: { address: { not: null }, soldAt: { gte: SINCE } },
    include: { community: { include: { builder: { select: { name: true } } } } },
  })

  console.log(`  DB: ${soldListings.length} homes sold since ${SINCE.toLocaleDateString()}\n`)

  // Build sold-only deltas per community
  const soldDeltas = {}
  for (const l of soldListings) {
    const key = `${l.community.builder.name}|${l.community.name}`
    if (!soldDeltas[key]) soldDeltas[key] = { builder: l.community.builder.name, community: l.community.name, count: 0 }
    soldDeltas[key].count++
  }

  // Group by builder
  const byBuilder = {}
  for (const d of Object.values(soldDeltas)) {
    if (!byBuilder[d.builder]) byBuilder[d.builder] = []
    byBuilder[d.builder].push(d)
  }

  let totalUpdated = 0

  for (const [builderName, comms] of Object.entries(byBuilder)) {
    const tabName = BUILDER_TABS[builderName]
    if (!tabName) continue

    console.log(`  ── ${builderName} (${tabName}) ──`)
    const rows = await readRows(token, tabName)

    for (const { community, count: soldCount } of comms) {
      let foundIndex = -1, current = null
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] ?? "").trim() === "Table 3") break
        if ((rows[i][3] ?? "").trim().toLowerCase() === community.toLowerCase()) {
          foundIndex = i
          current = {
            sold:    parseInt(rows[i][4] ?? "0") || 0,
            forSale: parseInt(rows[i][5] ?? "0") || 0,
            future:  parseInt(rows[i][6] ?? "0") || 0,
          }
          break
        }
      }
      if (!current) { console.warn(`    SKIP "${community}" — not in Table 2`); continue }

      // Calculate what the values SHOULD be:
      // Current sheet has our bad previous write baked in.
      // We need to know original values. We know:
      //   bad_script applied: sold += soldCount (correct), forSale += (newCount - soldCount) (wrong)
      //   correct should be:  sold += soldCount,           forSale -= soldCount
      //
      // So from current sheet state:
      //   original_forSale = current.forSale - bad_forSale_delta
      //   But we don't know bad_forSale_delta directly here.
      //
      // Simplest approach: apply the correct final values based on original + soldCount.
      // We reverse-engineer original by: original_sold = current.sold - soldCount
      // original_forSale = current.forSale + newCount (undo bad new_listing addition)
      //   but we don't have newCount here...
      //
      // Better: just set sold = current.sold (already has correct sold from bad run),
      //         set forSale = current.forSale - newCount_delta_from_bad_run
      //         where newCount_delta = bad_forSale_delta + soldCount
      //
      // Actually simplest: trust that sold count is correct (was correct in bad run too),
      // recalculate forSale as: original_forSale - soldCount
      // where original_forSale = forSale_before_bad_run
      //
      // We can compute forSale_before_bad_run from the bad run output we saw in logs.
      // OR: just read new fresh values from DB to reconstruct original.
      //
      // CLEANEST: set correct_forSale = current_forSale - (new_count_since_SINCE)
      //           which reverses just the bad part (new listing additions).
      //           The sold part was already correct.
      // We need new_count_since_SINCE for this community — query it below.
      console.log(`    "${community}": sold_delta=${soldCount}, need new_listing_count to compute correct forSale`)
    }
    console.log()
  }

  // Actually, let me do this properly in one pass
  console.log("\n  Recalculating with full data...\n")

  // Get new listings count too so we can reverse the bad delta
  const newListings = await prisma.listing.findMany({
    where: { address: { not: null }, firstDetected: { gte: SINCE } },
    include: { community: { include: { builder: { select: { name: true } } } } },
  })

  const newCounts = {}
  for (const l of newListings) {
    const key = `${l.community.builder.name}|${l.community.name}`
    newCounts[key] = (newCounts[key] ?? 0) + 1
  }

  // All communities touched by bad run
  const allKeys = new Set([...Object.keys(soldDeltas), ...Object.keys(newCounts)])
  const allChanges = []
  for (const key of allKeys) {
    const [builder, community] = key.split("|")
    const sold    = soldDeltas[key]?.count ?? 0
    const newCnt  = newCounts[key]       ?? 0
    const badForSaleDelta = newCnt - sold // what bad script applied to forSale
    const correctForSaleDelta = -sold     // what SHOULD have been applied
    const correction = correctForSaleDelta - badForSaleDelta // net correction to apply now
    if (sold === 0 && correction === 0) continue
    allChanges.push({ builder, community, sold, correction, badForSaleDelta })
  }

  // Group by builder and apply
  const byBuilderFull = {}
  for (const c of allChanges) {
    if (!byBuilderFull[c.builder]) byBuilderFull[c.builder] = []
    byBuilderFull[c.builder].push(c)
  }

  totalUpdated = 0
  for (const [builderName, comms] of Object.entries(byBuilderFull)) {
    const tabName = BUILDER_TABS[builderName]
    if (!tabName) continue
    console.log(`  ── ${builderName} (${tabName}) ──`)
    const rows = await readRows(token, tabName)

    for (const { community, correction, sold, badForSaleDelta } of comms) {
      let foundIndex = -1, current = null
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] ?? "").trim() === "Table 3") break
        if ((rows[i][3] ?? "").trim().toLowerCase() === community.toLowerCase()) {
          foundIndex = i
          current = {
            sold:    parseInt(rows[i][4] ?? "0") || 0,
            forSale: parseInt(rows[i][5] ?? "0") || 0,
            future:  parseInt(rows[i][6] ?? "0") || 0,
          }
          break
        }
      }
      if (!current) { console.warn(`    SKIP "${community}"`); continue }

      const newSold    = current.sold    // sold already correct from bad run
      const newForSale = Math.max(0, current.forSale + correction)
      const newFuture  = current.future
      const newTotal   = newSold + newForSale + newFuture

      if (correction === 0 && current.forSale === newForSale) {
        console.log(`    ✓ "${community}" — already correct (sold=${newSold}, forSale=${newForSale})`)
        continue
      }

      const sheetRow = foundIndex + 1
      await writeRow(token, tabName, sheetRow, newSold, newForSale, newFuture, newTotal)
      console.log(
        `    ✓ "${community}" row ${sheetRow}: ` +
        `sold=${newSold}, forSale ${current.forSale}→${newForSale} (correction=${correction >= 0 ? "+" : ""}${correction}), ` +
        `total=${newTotal}`
      )
      totalUpdated++
    }
    console.log()
  }

  console.log("=".repeat(70))
  console.log(` ✓ Done — ${totalUpdated} communities corrected`)
  console.log("=".repeat(70))
}

main()
  .catch(err => { console.error("FAILED:", err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
