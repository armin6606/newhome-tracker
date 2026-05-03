/**
 * Melia Homes Orange County Scraper — map-based diff
 *
 * Data source: sp.meliahomes.com/site-plans/{slug}/
 *   - Reads siteplanArray from page HTML (no browser needed)
 *   - Each entry has: residence (lot#), status, address, price, sqft, plan
 *
 * Primary ID: communityName + lotNumber (e.g. "Breckyn3", "Cerise109")
 * Fallback ID: address (when address is present)
 *
 * Status mapping:
 *   Available / Reserved → active
 *   Closed / Sold        → sold
 *   Future Phase / Future Home → future
 *   Model                → skip
 *
 * Run: node scripts/scrape-melia.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { fetchTable2Counts, reconcilePlaceholders } from "../../lib/sheet-table2.mjs"
import { sendWhatsApp, buildSummary } from "../../lib/notify.mjs"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, '../../.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}
const { PrismaClient } = require('../../node_modules/@prisma/client')
const prisma = new PrismaClient()

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const BUILDER_NAME  = "Melia Homes"
const BUILDER_URL   = "https://meliahomes.com"
const SHEET_TAB     = "Melia Communities"
const SITEPLAN_BASE = "https://sp.meliahomes.com/site-plans"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const MELIA_COMMUNITIES = [
  {
    name:     "Breckyn",
    city:     "Garden Grove",
    state:    "CA",
    url:      "https://meliahomes.com/new-homes/ca/garden-grove/breckyn/",
    spSlug:   "breckyn",
  },
  {
    name:     "Cerise at Citrus Square",
    city:     "Cypress",
    state:    "CA",
    url:      "https://meliahomes.com/new-homes/ca/cypress/cerise-at-citrus-square/",
    spSlug:   "cerise-at-citrus-square",
  },
  {
    name:     "Townes at Orange",
    city:     "Anaheim",
    state:    "CA",
    url:      "https://meliahomes.com/new-homes/ca/anaheim/townes-at-orange/",
    spSlug:   "townes-at-orange",
  },
]

const SUFFIX_RE = /,?\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?/i

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatus(status) {
  switch ((status || "").trim()) {
    case "Available":
    case "Reserved":    return "active"
    case "Closed":
    case "Sold":        return "sold"
    case "Future Phase":
    case "Future Home":
    case "Future":      return "future"
    default:            return null   // Model, etc. — skip
  }
}

function parsePrice(raw) {
  if (!raw) return null
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10)
  return n > 100000 ? n : null
}

function cleanAddress(addr) {
  if (!addr) return null
  return addr.replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim() || null
}

// Community name + lot number composite key (e.g. "Breckyn3", "Cerise109")
function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

// ---------------------------------------------------------------------------
// Fetch siteplanArray from sp.meliahomes.com
// ---------------------------------------------------------------------------

async function getSitePlanLots(communityName, spSlug) {
  const url = `${SITEPLAN_BASE}/${spSlug}/`
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`Site plan fetch failed: HTTP ${res.status} for ${url}`)

  const html  = await res.text()
  const match = html.match(/var siteplanArray\s*=\s*(\[[\s\S]*?\]);/)
  if (!match) throw new Error(`siteplanArray not found in ${url}`)

  const raw = JSON.parse(match[1])
  return raw.map(u => ({
    lotNumber: compositeKey(communityName, u.residence),  // e.g. "Breckyn3", "Cerise109"
    rawLot:    String(u.residence),
    status:    mapStatus(u.status),
    address:   cleanAddress(u.address),
    price:     parsePrice(u.price),
    sqft:      u.sqft ? parseInt(u.sqft.replace(/[^0-9]/g, ""), 10) || null : null,
    plan:      u.plan || null,
  }))
}

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

async function getDbActive(communityName) {
  const listings = await prisma.listing.findMany({
    where: { community: { name: communityName, builder: { name: BUILDER_NAME } } },
    select: { id: true, address: true, lotNumber: true, currentPrice: true, status: true },
  })
  const active = listings.filter(l => l.status === "active")
  return {
    byLotNumber:    new Map(active.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
    byAddress:      new Map(active.filter(l => l.address).map(l => [l.address, l])),
    placeholders: {
      sold:   listings.filter(l => l.status === "sold"   && /^sold-\d+$/.test(l.lotNumber ?? "")),
      avail:  listings.filter(l => l.status === "active" && /^avail-\d+$/.test(l.lotNumber ?? "")),
      future: listings.filter(l => l.status === "future" && /^future-\d+$/.test(l.lotNumber ?? "")),
    },
    realActiveCount: active.filter(l => l.lotNumber && !/^avail-\d+$/.test(l.lotNumber)).length,
  }
}

// ---------------------------------------------------------------------------
// POST to ingest
// ---------------------------------------------------------------------------

async function postIngest(comm, listings) {
  if (!listings.length) return null
  const payload = {
    builder:     { name: BUILDER_NAME, websiteUrl: BUILDER_URL },
    community:   { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
    listings,
    scraperMode: true,
  }
  const res  = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Ingest error ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function validatePriceSync(communityName, observedPrices) {
  if (observedPrices.size === 0) return

  const listings = await prisma.listing.findMany({
    where: {
      status:    "active",
      lotNumber: { not: null },
      community: { name: communityName, builder: { name: BUILDER_NAME } },
    },
    select: { lotNumber: true, currentPrice: true },
  })

  const drifted = []
  for (const l of listings) {
    const observed = observedPrices.get(l.lotNumber)
    if (observed == null) continue
    if (l.currentPrice !== observed)
      drifted.push({ address: l.lotNumber, db: l.currentPrice, site: observed })
  }

  if (drifted.length === 0) {
    console.log(`  ✔ Validation: all prices in sync`)
  } else {
    console.log(`  ✘ Validation FAILED: ${drifted.length} price drift(s) after ingest:`)
    for (const d of drifted)
      console.log(`      ${d.address}: DB=$${d.db?.toLocaleString() ?? "null"} Site=$${d.site?.toLocaleString()}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const results   = []
  console.log("=".repeat(60))
  console.log(`Melia Homes Scraper — Map-Based`)
  console.log(`${new Date().toISOString()}`)
  console.log("=".repeat(60))

  for (let comm of MELIA_COMMUNITIES) {
    comm = { ...comm, name: await resolveDbCommunityName(comm.name, BUILDER_NAME, prisma) }
    console.log(`\n${"─".repeat(56)}`)
    console.log(`${comm.name} (${comm.city}, ${comm.state})`)

    try {
      // 1. Fetch site plan lots
      const lots = await getSitePlanLots(comm.name, comm.spSlug)
      const activeLots  = lots.filter(l => l.status === "active")
      const soldLots    = lots.filter(l => l.status === "sold")
      const futureLots  = lots.filter(l => l.status === "future")
      console.log(`  Map: ${activeLots.length} active, ${soldLots.length} sold, ${futureLots.length} future, ${lots.filter(l=>!l.status).length} skipped`)

      // 2. Get DB active listings
      const db = await getDbActive(comm.name)
      console.log(`  DB active: ${db.byLotNumber.size}`)

      const toIngest = []
      let newCount = 0, soldCount = 0, priceCount = 0

      // 3a. Detect new and price-changed active lots
      for (const lot of activeLots) {
        const dbEntry = db.byLotNumber.get(lot.lotNumber)
          || (lot.address ? db.byAddress.get(lot.address) : null)

        if (!dbEntry) {
          // New listing
          const entry = { lotNumber: lot.lotNumber, status: "active" }
          if (lot.address)  entry.address      = lot.address
          if (lot.price)    entry.currentPrice = lot.price
          if (lot.sqft)     entry.sqft         = lot.sqft
          if (lot.plan)     entry.floorPlan    = lot.plan
          toIngest.push(entry)
          newCount++
          console.log(`  + New: ${lot.lotNumber}${lot.address ? ` (${lot.address})` : ""} $${lot.price?.toLocaleString() ?? "TBD"}`)
        } else if (lot.price && dbEntry.currentPrice !== lot.price) {
          // Price change
          toIngest.push({ lotNumber: lot.lotNumber, status: "active", currentPrice: lot.price })
          priceCount++
          console.log(`  ~ Price: ${lot.lotNumber} $${dbEntry.currentPrice?.toLocaleString()} → $${lot.price.toLocaleString()}`)
        }
      }

      // 3b. Detect newly sold (active in DB, but sold/closed on map)
      const mapSoldLots = new Set(soldLots.map(l => l.lotNumber))
      for (const [lotNum] of db.byLotNumber) {
        if (mapSoldLots.has(lotNum)) {
          toIngest.push({ lotNumber: lotNum, status: "sold" })
          soldCount++
          console.log(`  - Sold: ${lotNum}`)
        }
      }

      console.log(`  Diff — New: ${newCount}, Price changes: ${priceCount}, Sold: ${soldCount}`)

      // 4. Reconcile placeholder counts against Sheet Table 2
      const sheetCounts = await fetchTable2Counts(SHEET_TAB)
      const commCounts  = sheetCounts[comm.name] || null
      if (commCounts) {
        const { toIngest: phIngest, removeIds } = reconcilePlaceholders(
          commCounts, db.placeholders
        )
        toIngest.push(...phIngest)
        if (removeIds.length > 0) {
          await prisma.listing.updateMany({ where: { id: { in: removeIds } }, data: { status: "removed" } })
          console.log(`  Placeholders removed: ${removeIds.length}`)
        }
        if (phIngest.length > 0)
          console.log(`  Placeholders synced: +${phIngest.filter(l=>l.status==="sold").length} sold, +${phIngest.filter(l=>l.status==="active").length} avail, +${phIngest.filter(l=>l.status==="future").length} future`)
      }

      // Build observedPrices map for validation (lotNumber → price from site plan)
      const observedPrices = new Map()
      for (const lot of activeLots) {
        if (lot.lotNumber && lot.price != null) observedPrices.set(lot.lotNumber, lot.price)
      }

      if (toIngest.length === 0) {
        console.log("  ✓ No changes")
        await validatePriceSync(comm.name, observedPrices)
        results.push({ community: comm.name, changes: 0 })
        continue
      }

      const result = await postIngest(comm, toIngest)
      console.log(`  Ingest OK — created:${result?.created ?? "?"} updated:${result?.updated ?? "?"} priceChanges:${result?.priceChanges ?? "?"}`)
      await validatePriceSync(comm.name, observedPrices)
      results.push({
        community:     comm.name,
        changes:       newCount + soldCount + priceCount,
        newCount, soldCount, priceCount,
        newAddresses:  toIngest.filter(l => l.status === "active"  && l.address).map(l => l.address),
        soldAddresses: toIngest.filter(l => l.status === "sold"    && (l.address || l.lotNumber)).map(l => l.address || l.lotNumber),
      })

    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}`)
      results.push({ community: comm.name, error: err.message })
    }
  }

  await prisma.$disconnect()

  console.log("\n" + "=".repeat(60))
  console.log("Done.")
  console.log("=".repeat(60))

  await sendWhatsApp(buildSummary("Melia Homes", results, ((Date.now() - startTime) / 1000).toFixed(1)))
}

main().catch(async err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  const root = (err.stack || err.message || String(err)).split("\n").slice(0, 4).join("\n")
  await sendWhatsApp(`🚨 *New Key — Melia Homes Scraper CRASHED*\n\n${root}`)
  process.exit(1)
})
