/**
 * scrape-lennar.mjs
 * Automated Lennar scraper — Orange County, CA
 *
 * Run:      node scripts/scrape-lennar.mjs
 * Schedule: Windows Task Scheduler via run-scraper.bat at 1:00 AM daily
 *
 * Logic (per community):
 *   1. Read community list + city + propertyType from Google Sheet
 *   2. Fetch Lennar community page → extract homesite statuses from __NEXT_DATA__
 *   3. Compare map against current DB state:
 *        - Newly sold    : was active in DB, now sold on map → mark sold
 *        - Newly for-sale: active on map, not yet active in DB → add with address + price + moveInDate
 *   4. POST only changed listings to ingest (community-level info already in DB/Sheet)
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { fetchTable2Counts, reconcilePlaceholders } from "../../lib/sheet-table2.mjs"

const require    = createRequire(import.meta.url)
const __dirname  = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, "../../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/export?format=csv&gid=1235396983"
const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const LENNAR_BASE   = "https://www.lennar.com"

const SUFFIX_RE = /\b(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|way|wy|court|ct|place|pl|circle|cir|loop|lp|run|path|pass|trail|trl|terrace|ter|parkway|pkwy|alley|aly|row|walk)\b\.?$/i

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripSuffix(addr) {
  if (!addr) return null
  return addr.split(",")[0].trim().replace(SUFFIX_RE, "").trim()
}

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

function mapStatus(s) {
  switch ((s || "").toUpperCase()) {
    case "SOLD":                return "sold"
    case "AVAILABLE":
    case "UNDER_CONSTRUCTION":
    case "QUICK_MOVE_IN":      return "active"
    default:                   return "future"
  }
}

// ── Step 1: Read community list from Sheet ────────────────────────────────────

async function getCommunities() {
  const res  = await fetch(SHEET_CSV_URL, { redirect: "follow" })
  const rows = parseCSV(await res.text())

  const communities = []
  const cityByName  = {}
  const typeByName  = {}
  let inTable1 = false
  let inTable3 = false

  for (const row of rows) {
    if (row[0] === "Table 1") { inTable1 = true;  inTable3 = false; continue }
    if (row[0] === "Table 3") { inTable3 = true;  inTable1 = false; continue }

    if (inTable1) {
      if (row[0] === "Community" && row[1] === "URL") continue
      if (row[0] && row[1]?.startsWith("http")) communities.push({ name: row[0], url: row[1] })
    }

    if (inTable3) {
      if (row[0] === "Community") continue
      const commName = row[0]?.trim()
      if (commName && row[1]) cityByName[commName] = row[1].trim()
      if (commName && row[3] && !typeByName[commName]) typeByName[commName] = row[3].trim()
    }
  }

  for (const c of communities) {
    c.city = cityByName[c.name] || null
    c.type = typeByName[c.name] || null
  }

  if (communities.length === 0) throw new Error("No communities found in Sheet Table 1")
  console.log(`  Found ${communities.length} community(s) in Sheet`)
  return communities
}

// ── Step 2: Get current active listings from DB ───────────────────────────────

async function getDbActiveListings(communityName) {
  const listings = await prisma.listing.findMany({
    where: { community: { name: communityName, builder: { name: "Lennar" } } },
    select: { id: true, address: true, lotNumber: true, status: true, currentPrice: true },
  })
  const active = listings.filter(l => l.status === "active")
  const byAddress   = new Map(active.filter(l => l.address).map(l => [l.address, l]))
  const byLotNumber = new Map(active.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))
  return {
    byAddress,
    byLotNumber,
    placeholders: {
      sold:   listings.filter(l => l.status === "sold"   && /^sold-\d+$/.test(l.lotNumber ?? "")),
      avail:  listings.filter(l => l.status === "active" && /^avail-\d+$/.test(l.lotNumber ?? "")),
      future: listings.filter(l => l.status === "future" && /^future-\d+$/.test(l.lotNumber ?? "")),
    },
    realActiveCount: active.filter(l => l.address && !/^avail-\d+$/.test(l.lotNumber ?? "")).length,
  }
}

// ── Step 3: Fetch map data from Lennar page ───────────────────────────────────

async function getMapHomesites(communityName, communityUrl) {
  const res = await fetch(communityUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept":     "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html  = await res.text()
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error("No __NEXT_DATA__ found on page")

  const apollo = JSON.parse(match[1])?.props?.pageProps?.initialApolloState || {}

  const commEntry = Object.entries(apollo).find(([k, v]) =>
    k.startsWith("CommunityType:") && v.name === communityName
  )
  const commKey = commEntry?.[0] || null
  const urlSlug = communityUrl.split("/").pop()

  const homesites = []
  for (const [key, hs] of Object.entries(apollo)) {
    if (!key.startsWith("HomesiteType:")) continue

    const planRef   = hs.plan?.__ref
    const plan      = planRef ? apollo[planRef] : null
    const hsCommRef = plan?.community?.__ref || null

    const belongsHere = hsCommRef === commKey ||
                        (!hsCommRef && hs.url?.includes(urlSlug)) ||
                        (!hsCommRef && !hs.url && commKey)
    if (!belongsHere) continue

    const baths = (hs.baths || plan?.baths || 0) + (hs.halfBaths || plan?.halfBaths || 0) * 0.5 || null

    homesites.push({
      status:    mapStatus(hs.status),
      address:   stripSuffix(hs.address),
      lotNumber: hs.number ? compositeKey(communityName, hs.number) : null,
      price:     hs.price  || null,
      moveInDate: hs.closeDate || hs.moveInDate || hs.deliveryDate || null,
      sourceUrl: hs.url ? `${LENNAR_BASE}${hs.url}` : null,
      floorPlan: plan?.name || null,
      sqft:      hs.sqft   || plan?.sqft  || null,
      beds:      hs.beds   || plan?.beds  || null,
      baths,
    })
  }

  return homesites
}

// ── Step 4: Diff map vs DB and build change payload ───────────────────────────

function diffAndBuild(homesites, dbActive, sheetType) {
  const { byAddress, byLotNumber } = dbActive
  const toIngest = []

  let newCount   = 0
  let soldCount  = 0
  let priceCount = 0

  // Find newly for-sale or price changes on existing active listings
  for (const hs of homesites) {
    if (hs.status !== "active") continue

    const dbEntry = (hs.address   && byAddress.get(hs.address)) ||
                    (hs.lotNumber && byLotNumber.get(hs.lotNumber))

    if (!dbEntry) {
      // New for-sale lot
      const entry = { status: "active" }
      if (hs.address)    entry.address      = hs.address
      if (hs.lotNumber)  entry.lotNumber    = hs.lotNumber
      if (hs.price)      entry.currentPrice = hs.price
      if (hs.moveInDate) entry.moveInDate   = hs.moveInDate
      if (hs.sourceUrl)  entry.sourceUrl    = hs.sourceUrl
      if (sheetType)     entry.propertyType = sheetType
      if (hs.floorPlan)  entry.floorPlan    = hs.floorPlan
      if (hs.sqft)       entry.sqft         = hs.sqft
      if (hs.beds)       entry.beds         = hs.beds
      if (hs.baths)      entry.baths        = hs.baths
      toIngest.push(entry)
      newCount++
    } else if (hs.price != null && dbEntry.currentPrice !== hs.price) {
      // Price changed on existing active listing
      const entry = { status: "active", currentPrice: hs.price }
      if (hs.address)    entry.address    = hs.address
      if (hs.lotNumber)  entry.lotNumber  = hs.lotNumber
      if (hs.moveInDate) entry.moveInDate = hs.moveInDate
      if (hs.sourceUrl)  entry.sourceUrl  = hs.sourceUrl
      toIngest.push(entry)
      priceCount++
      console.log(`  ~ Price: ${hs.address || hs.lotNumber} $${dbEntry.currentPrice?.toLocaleString() ?? "—"} → $${hs.price.toLocaleString()}`)
    }
  }

  // Find newly sold: active in DB but now sold on map
  const mapSoldAddresses  = new Set(homesites.filter(h => h.status === "sold" && h.address).map(h => h.address))
  const mapSoldLotNumbers = new Set(homesites.filter(h => h.status === "sold" && h.lotNumber).map(h => h.lotNumber))

  for (const [address] of byAddress) {
    if (mapSoldAddresses.has(address)) {
      toIngest.push({ address, status: "sold" })
      soldCount++
    }
  }
  for (const [lotNumber] of byLotNumber) {
    const listing = byLotNumber.get(lotNumber)
    if (!listing.address && mapSoldLotNumbers.has(lotNumber)) {
      toIngest.push({ lotNumber, status: "sold" })
      soldCount++
    }
  }

  return { toIngest, newCount, soldCount, priceCount }
}

// ── Validation checkpoint ─────────────────────────────────────────────────────
// After ingest, re-query DB and verify stored prices match what was scraped.
// Logs a warning for any active listing whose DB price still differs from site.

async function validatePriceSync(communityName, observedPrices) {
  if (observedPrices.size === 0) return

  const listings = await prisma.listing.findMany({
    where: {
      status:    "active",
      address:   { not: null },
      community: { name: communityName, builder: { name: "Lennar" } },
    },
    select: { address: true, currentPrice: true },
  })

  const drifted = []
  for (const l of listings) {
    const observed = observedPrices.get(l.address)
    if (observed == null) continue                        // not in this scrape run
    if (l.currentPrice !== observed)
      drifted.push({ address: l.address, db: l.currentPrice, site: observed })
  }

  if (drifted.length === 0) {
    console.log(`  ✔ Validation: all prices in sync`)
  } else {
    console.log(`  ✘ Validation FAILED: ${drifted.length} price drift(s) after ingest:`)
    for (const d of drifted)
      console.log(`      ${d.address}: DB=$${d.db?.toLocaleString() ?? "null"} Site=$${d.site?.toLocaleString()}`)
  }
}

// ── Step 5: POST to New Key ingest ────────────────────────────────────────────

async function ingest(communityName, city, url, listings) {
  if (listings.length === 0) return { created: 0, updated: 0, priceChanges: 0 }

  const payload = {
    builder:     { name: "Lennar", websiteUrl: LENNAR_BASE },
    community:   { name: communityName, city, state: "CA", url },
    listings,
    scraperMode: true,
  }
  const res    = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify(payload),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(`Ingest failed (${res.status}): ${JSON.stringify(result)}`)
  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log(` Lennar OC Scraper — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  console.log("\nReading community list from Sheet …")
  const communities = await getCommunities()
  console.log(`\nProcessing ${communities.length} community(s)…\n`)

  let successCount = 0
  let totalNew     = 0
  let totalSold    = 0
  let totalPrice   = 0
  const failures   = []

  for (const { name: rawName, url, city, type } of communities) {
    const name = await resolveDbCommunityName(rawName, "Lennar", prisma)
    console.log(`─ ${name}`)
    try {
      const [homesites, dbActive] = await Promise.all([
        getMapHomesites(rawName, url),
        getDbActiveListings(name),
      ])

      // Build observed price map for validation checkpoint
      const observedPrices = new Map(
        homesites.filter(h => h.status === "active" && h.address && h.price)
                 .map(h => [h.address, h.price])
      )

      const { toIngest, newCount, soldCount, priceCount } = diffAndBuild(homesites, dbActive, type)

      // ── Reconcile placeholder counts against Sheet Table 2 ────────────
      const sheetCounts = await fetchTable2Counts("Lennar Communities")
      const commCounts  = sheetCounts[name] || sheetCounts[rawName] || null
      if (commCounts) {
        const { toIngest: phIngest, removeIds } = reconcilePlaceholders(
          commCounts, dbActive.placeholders
        )
        toIngest.push(...phIngest)
        if (removeIds.length > 0) {
          await prisma.listing.updateMany({ where: { id: { in: removeIds } }, data: { status: "removed" } })
          console.log(`  Placeholders removed: ${removeIds.length}`)
        }
        if (phIngest.length > 0)
          console.log(`  Placeholders synced: +${phIngest.filter(l=>l.status==="sold").length} sold, +${phIngest.filter(l=>l.status==="active").length} avail, +${phIngest.filter(l=>l.status==="future").length} future`)
      }

      if (toIngest.length === 0) {
        console.log(`  ✓ No changes`)
        await validatePriceSync(name, observedPrices)
        console.log()
        successCount++
        continue
      }

      await ingest(name, city, url, toIngest)

      if (newCount   > 0) console.log(`  + ${newCount} newly for-sale`)
      if (soldCount  > 0) console.log(`  ✗ ${soldCount} newly sold`)
      if (priceCount > 0) console.log(`  ~ ${priceCount} price change(s)`)

      await validatePriceSync(name, observedPrices)
      console.log()

      successCount++
      totalNew   += newCount
      totalSold  += soldCount
      totalPrice += priceCount
    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}\n`)
      failures.push({ name, error: err.message })
    }
  }

  await prisma.$disconnect()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("=".repeat(60))
  console.log(` Run Summary`)
  console.log("=".repeat(60))
  console.log(`  Communities  : ${successCount} / ${communities.length} succeeded`)
  console.log(`  New for-sale : ${totalNew}`)
  console.log(`  Newly sold   : ${totalSold}`)
  console.log(`  Price changes: ${totalPrice}`)
  if (failures.length > 0) {
    console.log(`  Failures     : ${failures.length}`)
    failures.forEach(f => console.log(`    • ${f.name}: ${f.error}`))
  }
  console.log(`\n  Elapsed: ${elapsed}s`)
  console.log("=".repeat(60))

  if (successCount === 0 && communities.length > 0) process.exit(1)
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
