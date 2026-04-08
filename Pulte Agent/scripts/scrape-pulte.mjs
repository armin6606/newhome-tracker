/**
 * Pulte Agent — Map-Based Diff Scraper
 *
 * Map source: Zonda Virtual (apps.zondavirtual.com/olajson/{OLAId}.json)
 * No browser needed — direct API fetch.
 *
 * Logic:
 *   1. Fetch Zonda map data → all lots + statuses
 *   2. For-sale lots = status "Available" or "Quick Move In"
 *   3. Fetch Pulte QMI API → prices for for-sale homes
 *   4. Diff against DB active listings:
 *      - New for-sale → POST to ingest with address, price, moveInDate
 *      - DB active but no longer for-sale → POST as "sold"
 *      - Price changed → POST updated price
 *
 * Run: node "Pulte Agent/scripts/scrape-pulte.mjs"
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { fetchTable2Counts, reconcilePlaceholders } from "../../lib/sheet-table2.mjs"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("../../node_modules/@prisma/client")
const prisma = new PrismaClient()

// ─── Config ─────────────────────────────────────────────────────────────────

const BUILDER_NAME  = "Pulte"
const SHEET_TAB     = "Pulte Communities"
const BUILDER_URL   = "https://www.pulte.com"
const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"

// To add a new community: paste the URL, find OLAId from page HTML (OLAId= pattern),
// find communityId from page HTML or URL slug number
const COMMUNITIES = [
  {
    name:        "Icon at Luna Park",
    city:        "Irvine",
    state:       "CA",
    url:         "https://www.pulte.com/homes/california/orange-county/irvine/icon-at-luna-park-211549",
    olaId:       "09341369-396d-4225-b89c-24625f0d129e",
    communityId: "211549",
    // Table 3 — plan details keyed by Zonda planName
    plans: {
      "Plan 1": { sqft: 2104, beds: 3, baths: 4,   propertyType: "Condominium" },
      "Plan 2": { sqft: 2276, beds: 4, baths: 3.5, propertyType: "Condominium" },
      "Plan 3": { sqft: 2439, beds: 4, baths: 3.5, propertyType: "Condominium" },
      "Plan 4": { sqft: 2608, beds: 4, baths: 3.5, propertyType: "Condominium" },
    },
  },
  {
    name:        "Parallel at Luna Park",
    city:        "Irvine",
    state:       "CA",
    url:         "https://www.pulte.com/homes/california/orange-county/irvine/parallel-at-luna-park-211550",
    olaId:       "a3bea538-d2e9-4ac7-8fad-8111f30744ef",
    communityId: "211550",
    // Table 3 — plan details keyed by Zonda planName
    plans: {
      "Plan 1": { sqft: 2060, beds: 3, baths: 3.5, propertyType: "Condominium" },
      "Plan 2": { sqft: 2352, beds: 3, baths: 3.5, propertyType: "Condominium" },
      "Plan 3": { sqft: 2371, beds: 3, baths: 3.5, propertyType: "Condominium" },
    },
  },
  // Arden at Luna Park (211653) and Eclipse at Luna Park (211654) are coming soon — add olaId when live
]

const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")
    .replace(STREET_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim()
}

function formatMoveIn(raw) {
  if (!raw || raw.toLowerCase().includes("contact")) return null
  return raw.trim()
}

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

// ─── Zonda Virtual Map ──────────────────────────────────────────────────────

async function fetchZondaLots(olaId) {
  const url = `https://apps.zondavirtual.com/olajson/${olaId}.json`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  })
  if (!res.ok) throw new Error(`Zonda API ${res.status} for OLAId ${olaId}`)
  const data = await res.json()
  const lots = data.MasterSiteplan?.LotDetails || []

  return lots.map(lot => {
    const attrs = {}
    for (const a of lot.LotAttributes || []) {
      attrs[a.AttributeName?.toLowerCase()] = a.Value
    }
    let moveIn = null
    for (const info of lot.infoList || []) {
      if (info.Key === "Est Move In Date") { moveIn = info.Value; break }
    }
    return {
      status:    lot.status,
      address:   cleanAddress(attrs["address"] || ""),
      lotNumber: lot.LotNumber ? String(lot.LotNumber) : null,
      moveInDate: formatMoveIn(moveIn),
      planName:  attrs["preplotted_plan"] || attrs["homes"] || null,
    }
  })
}

// ─── Pulte QMI API (for pricing) ────────────────────────────────────────────

async function fetchQmiPrices(communityId) {
  const url = `${BUILDER_URL}/api/plan/qmiplans?communityId=${communityId}`
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    BUILDER_URL + "/",
      },
    })
    if (!res.ok) return new Map()
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.plans || data.qmiPlans || [])

    const priceMap = new Map()
    for (const item of items) {
      const homes = item.qmiHomes || item.homes || (item.address ? [item] : [])
      for (const home of homes) {
        const street = home.address?.street1 || home.address?.street || (typeof home.address === "string" ? home.address : "")
        const addr = cleanAddress(street)
        if (!addr) continue
        const price  = typeof home.price === "number" ? home.price : parseInt(String(home.price || "").replace(/\D/g, "")) || null
        const moveIn = home.dateAvailable || home.moveInDate || null
        const srcUrl = home.inventoryPageURL || home.inventoryPageUrl || null
        priceMap.set(addr, { price, moveIn, sourceUrl: srcUrl })
      }
    }
    return priceMap
  } catch (e) {
    console.warn(`  QMI API error: ${e.message}`)
    return new Map()
  }
}

// ─── DB helper ──────────────────────────────────────────────────────────────

async function getDbActive(communityName) {
  const listings = await prisma.listing.findMany({
    where: { community: { name: communityName, builder: { name: BUILDER_NAME } } },
    select: { id: true, address: true, lotNumber: true, currentPrice: true, status: true },
  })
  const active = listings.filter(l => l.status === "active")
  return {
    byAddress:       new Map(active.filter(l => l.address).map(l => [l.address, l])),
    byLot:           new Map(active.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
    placeholders: {
      sold:   listings.filter(l => l.status === "sold"   && /^sold-\d+$/.test(l.lotNumber ?? "")),
      avail:  listings.filter(l => l.status === "active" && /^avail-\d+$/.test(l.lotNumber ?? "")),
      future: listings.filter(l => l.status === "future" && /^future-\d+$/.test(l.lotNumber ?? "")),
    },
    realActiveCount: active.filter(l => l.address && !/^avail-\d+$/.test(l.lotNumber ?? "")).length,
  }
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

async function postIngest(comm, listings) {
  if (!listings.length) return
  const payload = {
    builder:     { name: BUILDER_NAME, websiteUrl: BUILDER_URL },
    community:   { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
    listings,
    scraperMode: true,
  }
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) console.log(`  Ingest error ${res.status}: ${JSON.stringify(json)}`)
  else console.log(`  Ingest OK — created:${json.created} updated:${json.updated} priceChanges:${json.priceChanges}`)
}

// ─── Process one community ───────────────────────────────────────────────────

async function processCommunity(comm) {
  comm = { ...comm, name: await resolveDbCommunityName(comm.name, BUILDER_NAME, prisma) }
  console.log(`\n${"─".repeat(50)}`)
  console.log(`${comm.name}`)

  const zondaLots   = await fetchZondaLots(comm.olaId)
  const forSaleLots = zondaLots.filter(l => l.status === "Available" || l.status === "Quick Move In")

  console.log(`  Map: ${forSaleLots.length} for-sale, ${zondaLots.filter(l => l.status === "Sold").length} sold, ${zondaLots.length} total`)

  const qmiPrices = await fetchQmiPrices(comm.communityId)
  const db        = await getDbActive(comm.name)

  const mapByAddr      = new Map(forSaleLots.filter(l => l.address).map(l => [l.address, l]))
  const mapByLot       = new Map(forSaleLots.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))
  // Index ALL Zonda lots by address and lot number for sold-check below
  const zondaByAddr    = new Map(zondaLots.filter(l => l.address).map(l => [l.address, l]))
  const zondaByLotNum  = new Map(zondaLots.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))

  const toIngest = []

  for (const lot of forSaleLots) {
    const qmi    = qmiPrices.get(lot.address) || null
    const price  = qmi?.price ?? null
    const moveIn = qmi?.moveIn || lot.moveInDate || null
    const srcUrl = qmi?.sourceUrl || comm.url

    const dbEntry = (lot.address && db.byAddress.get(lot.address))
      || (lot.lotNumber && db.byLot.get(lot.lotNumber))

    if (!dbEntry) {
      console.log(`  + New: ${lot.address || `Lot ${lot.lotNumber}`} $${price?.toLocaleString() ?? "TBD"}`)
      const planDetails = (comm.plans && lot.planName) ? (comm.plans[lot.planName] || {}) : {}
      const entry = { address: lot.address, lotNumber: lot.lotNumber ? compositeKey(comm.name, lot.lotNumber) : null, currentPrice: price, moveInDate: moveIn, status: "active", sourceUrl: srcUrl, floorPlan: lot.planName || null, ...planDetails }
      toIngest.push(entry)
    } else if (price !== null && dbEntry.currentPrice !== price) {
      console.log(`  ~ Price: ${lot.address} $${dbEntry.currentPrice?.toLocaleString()} → $${price.toLocaleString()}`)
      toIngest.push({ address: lot.address, lotNumber: lot.lotNumber ? compositeKey(comm.name, lot.lotNumber) : null, currentPrice: price, moveInDate: moveIn, status: "active", sourceUrl: srcUrl })
    }
  }

  for (const [addr, dbEntry] of db.byAddress.entries()) {
    const stillForSale = mapByAddr.has(addr) || (dbEntry.lotNumber && mapByLot.has(dbEntry.lotNumber))
    if (!stillForSale) {
      // Only mark sold if Zonda explicitly says "Sold" — never mark sold just because
      // the home dropped off the Available/QMI list (could be Reserved, Optioned, API glitch, etc.)
      const rawLotNum  = dbEntry.lotNumber?.replace(/^[A-Za-z]+/, "") ?? null  // strip community prefix
      const zondaEntry = zondaByAddr.get(addr) || (rawLotNum ? zondaByLotNum.get(rawLotNum) : null)
      if (zondaEntry?.status === "Sold") {
        console.log(`  - Sold: ${addr} (Zonda status: Sold)`)
        toIngest.push({ address: addr, lotNumber: dbEntry.lotNumber, status: "sold" })
      } else {
        console.log(`  ? ${addr} not in for-sale (Zonda: ${zondaEntry?.status ?? "not found"}) — skipped`)
      }
    }
  }

  console.log(`  Diff — New/Updated: ${toIngest.filter(l => l.status === "active").length}, Sold: ${toIngest.filter(l => l.status === "sold").length}`)

  // ── Reconcile placeholder counts against Sheet Table 2 ──────────────────
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

  // Build observedPrices map for validation (address → price from QMI API)
  const observedPrices = new Map()
  for (const lot of forSaleLots) {
    if (!lot.address) continue
    const qmi = qmiPrices.get(lot.address) || null
    if (qmi?.price != null) observedPrices.set(lot.address, qmi.price)
  }

  if (toIngest.length > 0) await postIngest(comm, toIngest)
  else console.log("  No changes")

  await validatePriceSync(comm.name, observedPrices)

  return { community: comm.name, changes: toIngest.length }
}

// ─── Validation ──────────────────────────────────────────────────────────────

async function validatePriceSync(communityName, observedPrices) {
  if (observedPrices.size === 0) return

  const listings = await prisma.listing.findMany({
    where: {
      status:    "active",
      address:   { not: null },
      community: { name: communityName, builder: { name: BUILDER_NAME } },
    },
    select: { address: true, currentPrice: true },
  })

  const drifted = []
  for (const l of listings) {
    const observed = observedPrices.get(l.address)
    if (observed == null) continue
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log("Pulte Agent — Map-Based Scraper")
  console.log(`${new Date().toISOString()}`)
  console.log("=".repeat(60))

  const results = []
  for (const comm of COMMUNITIES) {
    try {
      results.push(await processCommunity(comm))
    } catch (e) {
      console.error(`  ERROR processing ${comm.name}: ${e.message}`)
      results.push({ community: comm.name, error: e.message })
    }
  }

  console.log("\n" + "=".repeat(60))
  console.log("DONE")
  for (const r of results) {
    if (r.error) console.log(`  ${r.community}: ERROR — ${r.error}`)
    else console.log(`  ${r.community}: ${r.changes} change(s)`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error("Fatal:", e); prisma.$disconnect(); process.exit(1) })
