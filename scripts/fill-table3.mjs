/**
 * fill-table3.mjs
 *
 * Daily 3 AM — reads Table 3 from every builder's Google Sheet tab and fills
 * in missing fields on real listings (beds, baths, sqft, floors, propertyType,
 * hoaFees, taxes, moveInDate).
 *
 * RULES (enforced in code):
 *   MUST: Only fill fields that are currently null in the DB
 *   MUST NOT: Overwrite any existing non-null value
 *   MUST NOT: Touch placeholder listings (address IS NULL)
 *   MUST NOT: Change status, address, lotNumber, currentPrice, soldAt, or any
 *             field not sourced from Table 3
 *   MUST: Match by community name (exact, case-insensitive) + floorplan name
 *         (exact, case-insensitive)
 *   MUST NOT: Fill a listing that has no floorPlan value (no match possible)
 *
 * Table 3 columns (0-indexed):
 *   0  Community   1  City   2  Floorplan   3  Type (propertyType)
 *   4  Floors      5  Sqft   6  Bedrooms    7  Bathrooms
 *   8  Ready By (moveInDate)  9  HOA  10  Tax
 *
 * Run: node scripts/fill-table3.mjs
 * Schedule: Windows Task Scheduler → 3:00 AM daily
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
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

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

// Exact same map as sheet-validator — only these builders are permitted
const BUILDER_SHEET_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
  "Shea Homes":      "Shea Communities",
}

// ── CSV parser ─────────────────────────────────────────────────────────────

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')               inQ = !inQ
      else if (ch === "," && !inQ){ cells.push(cur.trim()); cur = "" }
      else                          cur += ch
    }
    return cells
  })
}

// ── Value parsers ──────────────────────────────────────────────────────────

function toInt(val) {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function toFloat(val) {
  if (!val) return null
  // Handle ranges like "3-4" → take the first number
  const cleaned = String(val).split(/[-–]/)[0].replace(/[^0-9.]/g, "")
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function toStr(val) {
  const s = String(val ?? "").trim()
  return s === "" ? null : s
}

/**
 * Normalize a floorplan name for fuzzy matching.
 * Rules:
 *  - Strip community name prefix (full name or first word) e.g. "Aria " from "Aria 1AX"
 *  - Strip "Plan " prefix
 *  - Extract the numeric portion + keep X if present, drop all other letters
 *    e.g. "Aria 1AX" → "1x", "Hazel 2M" → "2", "Crest 3BXR" → "3x"
 */
function normalizePlan(communityName, planName) {
  if (!planName) return null
  let s = planName.trim()

  // Strip "Plan " prefix
  s = s.replace(/^Plan\s+/i, "")

  // Strip community full name or first word prefix
  const escaped = communityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  s = s.replace(new RegExp(`^${escaped}\\s+`, "i"), "")
  const firstWord = communityName.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  s = s.replace(new RegExp(`^${firstWord}\\s+`, "i"), "").trim()

  // Extract: digit(s) + keep X, drop all other letters
  const m = s.match(/^(\d+)([A-Za-z]*)/)
  if (!m) return planName.toLowerCase().trim()
  return (m[1] + (/x/i.test(m[2]) ? "X" : "")).toLowerCase()
}

// ── Fetch and parse Table 3 from a sheet tab ───────────────────────────────

async function fetchTable3(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status}) for tab "${tabName}"`)

  const rows = parseCSV(await res.text())

  // Table 3 starts after a row where col[0] or col[3] === "Table 3"
  // and ends at end of file
  let inTable3 = false
  const table3 = [] // { community, floorplan, propertyType, floors, sqft, beds, baths, moveInDate, hoaFees, taxes }

  for (const row of rows) {
    const col0 = row[0]?.trim() ?? ""
    const col3 = row[3]?.trim() ?? ""

    if (!inTable3) {
      if (col0 === "Table 3" || col3 === "Table 3") inTable3 = true
      continue
    }

    // Skip header row (Community, City, Floorplan, ...)
    const community = row[0]?.trim()
    const floorplan = row[2]?.trim()
    if (!community || !floorplan) continue
    if (community === "Community") continue // header row

    table3.push({
      community:    community.toLowerCase(),
      floorplan:    floorplan.toLowerCase(),
      propertyType: toStr(row[3]),
      floors:       toInt(row[4]),
      sqft:         toInt(row[5]),
      beds:         toFloat(row[6]),
      baths:        toFloat(row[7]),
      moveInDate:   toStr(row[8]),
      hoaFees:      toInt(row[9]),
      taxes:        toStr(row[10]),
    })
  }

  // Build lookup map: communityKey → floorplanKey → data
  // Each plan is indexed under both its exact key AND its normalized key
  const map = new Map()
  for (const entry of table3) {
    if (!map.has(entry.community)) map.set(entry.community, new Map())
    const inner = map.get(entry.community)
    inner.set(entry.floorplan, entry)
    const normKey = normalizePlan(entry.community, entry.floorplan)
    if (normKey && normKey !== entry.floorplan) inner.set(normKey, entry)
  }

  return map
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log(` New Key Table 3 Fill — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  let totalFilled = 0
  let totalSkipped = 0
  let totalNoMatch = 0

  for (const [builderName, tabName] of Object.entries(BUILDER_SHEET_TABS)) {
    console.log(`\n── ${builderName} (${tabName})`)

    // Fetch Table 3
    let table3Map
    try {
      table3Map = await fetchTable3(tabName)
      const communityCount = table3Map.size
      const planCount = [...table3Map.values()].reduce((s, m) => s + m.size, 0)
      console.log(`   Table 3: ${communityCount} communities, ${planCount} floorplans`)
    } catch (err) {
      console.error(`   ✗ Sheet read failed: ${err.message}`)
      continue
    }

    if (table3Map.size === 0) {
      console.log(`   No Table 3 data — skipping`)
      continue
    }

    // Load all real listings for this builder that have a floorPlan
    const listings = await prisma.listing.findMany({
      where: {
        address:   { not: null },  // GUARDRAIL: real listings only, never placeholders
        floorPlan: { not: null },  // need floorPlan to match Table 3
        community: { builder: { name: builderName } },
        status:    { not: "removed" },
      },
      select: {
        id:           true,
        floorPlan:    true,
        sqft:         true,
        beds:         true,
        baths:        true,
        floors:       true,
        propertyType: true,
        hoaFees:      true,
        taxes:        true,
        moveInDate:   true,
        currentPrice: true,
        pricePerSqft: true,
        community:    { select: { name: true } },
      },
    })

    console.log(`   ${listings.length} real listings with floorPlan`)

    for (const listing of listings) {
      // GUARDRAIL: check if any fields are actually missing
      const needsFill =
        listing.sqft         === null ||
        listing.beds         === null ||
        listing.baths        === null ||
        listing.floors       === null ||
        listing.propertyType === null ||
        listing.hoaFees      === null ||
        listing.taxes        === null ||
        listing.moveInDate   === null

      if (!needsFill) {
        totalSkipped++
        continue
      }

      // Look up in Table 3 — exact match first, normalized fallback
      const commKey  = listing.community.name.toLowerCase()
      const planKey  = listing.floorPlan.toLowerCase()
      const commMap  = table3Map.get(commKey)
      const normKey  = normalizePlan(listing.community.name, listing.floorPlan)
      const t3Entry  = commMap
        ? (commMap.get(planKey) ?? (normKey ? commMap.get(normKey) : null))
        : null

      if (!t3Entry) {
        totalNoMatch++
        continue
      }

      // GUARDRAIL: only fill null fields — never overwrite existing values
      const update = {}
      if (listing.sqft         === null && t3Entry.sqft         !== null) update.sqft         = t3Entry.sqft
      if (listing.beds         === null && t3Entry.beds         !== null) update.beds         = t3Entry.beds
      if (listing.baths        === null && t3Entry.baths        !== null) update.baths        = t3Entry.baths
      if (listing.floors       === null && t3Entry.floors       !== null) update.floors       = t3Entry.floors
      if (listing.propertyType === null && t3Entry.propertyType !== null) update.propertyType = t3Entry.propertyType
      if (listing.hoaFees      === null && t3Entry.hoaFees      !== null) update.hoaFees      = t3Entry.hoaFees
      if (listing.taxes        === null && t3Entry.taxes        !== null) update.taxes        = t3Entry.taxes
      if (listing.moveInDate   === null && t3Entry.moveInDate   !== null) update.moveInDate   = t3Entry.moveInDate

      // Recalculate pricePerSqft whenever sqft becomes known and price exists
      const finalSqft  = update.sqft ?? listing.sqft
      if (listing.currentPrice && finalSqft && listing.pricePerSqft === null) {
        update.pricePerSqft = Math.round(listing.currentPrice / finalSqft)
      }

      if (Object.keys(update).length === 0) {
        totalSkipped++
        continue
      }

      await prisma.listing.update({
        where: { id: listing.id },
        data:  update,
      })

      console.log(`   ✓ [${listing.community.name}] ${listing.floorPlan}: filled ${Object.keys(update).join(", ")}`)
      totalFilled++
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("\n" + "=".repeat(60))
  console.log(` Summary: ${totalFilled} filled | ${totalSkipped} already complete | ${totalNoMatch} no Table 3 match | ${elapsed}s`)
  console.log("=".repeat(60))
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
