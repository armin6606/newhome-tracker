/**
 * Del Webb Agent — Map-Based Diff Scraper
 *
 * Map source: Zonda Virtual (apps.zondavirtual.com/olajson/{OLAId}.json)
 * No browser needed — direct API fetch.
 *
 * Logic:
 *   1. Fetch Zonda map data → all lots + statuses
 *   2. For-sale lots = status "Available" or "Quick Move In"
 *   3. Fetch Del Webb QMI API → prices for for-sale homes
 *   4. Diff against DB active listings:
 *      - New for-sale → POST to ingest with address, price, moveInDate
 *      - DB active but no longer for-sale → POST as "sold"
 *      - Price changed → POST updated price
 *
 * Run: node "Del Webb Agent/scripts/scrape-delwebb.mjs"
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { fetchTable2Counts, reconcilePlaceholders } from "../../lib/sheet-table2.mjs"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// .env.local is two levels up (New Key root)
const envPath = resolve(__dirname, "../../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("../../node_modules/@prisma/client")
const prisma = new PrismaClient()

// ─── Config ────────────────────────────────────────────────────────────────

const BUILDER_NAME  = "Del Webb"
const SHEET_TAB     = "Del Webb Communities"
const BUILDER_URL   = "https://www.delwebb.com"
const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"

// Zonda Virtual map + Del Webb QMI API params per community
const COMMUNITIES = [
  {
    name:        "Luna at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    state:       "CA",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498",
    olaId:       "2a66dabe-28ef-4263-8b33-79ad9349ef12",
    communityId: "211498",
    // Table 3 — plan details keyed by Zonda planName
    plans: {
      "Plan 1":  { sqft: 1844, beds: 2, baths: 2.5, floors: 1, propertyType: "Single Family" },
      "Plan 2":  { sqft: 1907, beds: 2, baths: 2.5, floors: 1, propertyType: "Single Family" },
      "Plan 1X": { sqft: 2484, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 2X": { sqft: 2736, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 3":  { sqft: 2806, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
    },
  },
  {
    name:        "Elara at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    state:       "CA",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/elara-at-gavilan-ridge-211497",
    olaId:       "377e33ce-3f1f-4836-9643-46642de99a81",
    communityId: "211497",
    // Table 3 — plan details keyed by Zonda planName
    plans: {
      "Plan 1": { sqft: 2454, beds: 3, baths: 3,   floors: 2, propertyType: "Single Family" },
      "Plan 2": { sqft: 2692, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 3": { sqft: 2911, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
    },
  },
]

const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")
    .replace(STREET_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim()
}

function formatMoveIn(raw) {
  // raw can be "2026-05", "May 2026", "Contact Us", or ""
  if (!raw || raw.toLowerCase().includes("contact")) return null
  return raw.trim()
}

// ─── Zonda Virtual Map ──────────────────────────────────────────────────────

async function fetchZondaLots(olaId, communityName) {
  const url = `https://apps.zondavirtual.com/olajson/${olaId}.json`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  })
  if (!res.ok) throw new Error(`Zonda API ${res.status} for OLAId ${olaId}`)
  const data = await res.json()
  const lots = data.MasterSiteplan?.LotDetails || []

  const result = []
  for (const lot of lots) {
    const status = lot.status // "Available", "Quick Move In", "Sold", "Unreleased", "Model"

    // Build attribute map
    const attrs = {}
    for (const a of lot.LotAttributes || []) {
      attrs[a.AttributeName?.toLowerCase()] = a.Value
    }

    // Move-in date from infoList
    let moveIn = null
    for (const info of lot.infoList || []) {
      if (info.Key === "Est Move In Date") { moveIn = info.Value; break }
    }

    const rawAddress = attrs["address"] || ""
    const address    = cleanAddress(rawAddress)

    result.push({
      status,
      address,
      lotNumber: lot.LotNumber ? compositeKey(communityName, lot.LotNumber) : null,
      moveInDate: formatMoveIn(moveIn),
      planName:  attrs["preplotted_plan"] || attrs["homes"] || null,
    })
  }
  return result
}

// ─── Del Webb QMI API (for pricing) ────────────────────────────────────────

async function fetchQmiPrices(communityId) {
  const url = `${BUILDER_URL}/api/plan/qmiplans?communityId=${communityId}`
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": BUILDER_URL + "/",
      },
    })
    if (!res.ok) return new Map()
    const data = await res.json()
    const items = Array.isArray(data) ? data : (data.plans || data.qmiPlans || [])

    // Map: cleanAddress → { price, moveInDate, sourceUrl }
    const priceMap = new Map()
    for (const item of items) {
      const homes = item.qmiHomes || item.homes || (item.address ? [item] : [])
      for (const home of homes) {
        const street = home.address?.street1 || home.address?.street || (typeof home.address === "string" ? home.address : "")
        const addr = cleanAddress(street)
        if (!addr) continue
        const price   = typeof home.price === "number" ? home.price : parseInt(String(home.price || "").replace(/\D/g, "")) || null
        const moveIn  = home.dateAvailable || home.moveInDate || null
        const srcUrl  = home.inventoryPageURL || home.inventoryPageUrl || null
        priceMap.set(addr, { price, moveIn, sourceUrl: srcUrl })
      }
    }
    return priceMap
  } catch (e) {
    console.warn(`  QMI API error: ${e.message}`)
    return new Map()
  }
}

// ─── DB helper ─────────────────────────────────────────────────────────────

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

// ─── Ingest ─────────────────────────────────────────────────────────────────

async function postIngest(comm, listings) {
  if (!listings.length) return
  const payload = {
    builder:   { name: BUILDER_NAME, websiteUrl: BUILDER_URL },
    community: { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
    listings,
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

// ─── Process one community ──────────────────────────────────────────────────

async function processCommunity(comm) {
  comm = { ...comm, name: await resolveDbCommunityName(comm.name, BUILDER_NAME, prisma) }
  console.log(`\n${"─".repeat(50)}`)
  console.log(`${comm.name}`)

  // 1. Zonda map: all lots with status
  const zondaLots = await fetchZondaLots(comm.olaId, comm.name)
  const forSaleLots = zondaLots.filter(l => l.status === "Available" || l.status === "Quick Move In")
  const soldLots    = zondaLots.filter(l => l.status === "Sold")

  console.log(`  Map: ${forSaleLots.length} for-sale, ${soldLots.length} sold, ${zondaLots.length} total`)

  // 2. QMI API for pricing
  const qmiPrices = await fetchQmiPrices(comm.communityId)

  // 3. DB active listings
  const db = await getDbActive(comm.name)

  // Build for-sale lookup by address
  const mapForSaleByAddr = new Map()
  const mapForSaleByLot  = new Map()
  for (const lot of forSaleLots) {
    if (lot.address) mapForSaleByAddr.set(lot.address, lot)
    if (lot.lotNumber) mapForSaleByLot.set(lot.lotNumber, lot)
  }

  const toIngest = []

  // ── New for-sale + price changes ──
  for (const lot of forSaleLots) {
    const qmi = qmiPrices.get(lot.address) || null
    const price = qmi?.price ?? null
    const moveIn = qmi?.moveIn || lot.moveInDate || null
    const srcUrl = qmi?.sourceUrl || comm.url

    const dbEntry = (lot.address && db.byAddress.get(lot.address))
      || (lot.lotNumber && db.byLot.get(lot.lotNumber))

    if (!dbEntry) {
      // New
      console.log(`  + New: ${lot.address || `Lot ${lot.lotNumber}`} $${price?.toLocaleString() ?? "TBD"}`)
      const planDetails = (comm.plans && lot.planName) ? (comm.plans[lot.planName] || {}) : {}
      toIngest.push({ address: lot.address, lotNumber: lot.lotNumber, currentPrice: price, moveInDate: moveIn, status: "active", sourceUrl: srcUrl, floorPlan: lot.planName || null, ...planDetails })
    } else if (price !== null && dbEntry.currentPrice !== price) {
      // Price change
      console.log(`  ~ Price: ${lot.address} $${dbEntry.currentPrice?.toLocaleString()} → $${price.toLocaleString()}`)
      toIngest.push({ address: lot.address, lotNumber: lot.lotNumber, currentPrice: price, moveInDate: moveIn, status: "active", sourceUrl: srcUrl })
    }
  }

  // ── Sold: active in DB but not for-sale on map ──
  for (const [addr, dbEntry] of db.byAddress.entries()) {
    const stillForSale = mapForSaleByAddr.has(addr)
      || (dbEntry.lotNumber && mapForSaleByLot.has(dbEntry.lotNumber))
    if (!stillForSale) {
      console.log(`  - Sold: ${addr}`)
      toIngest.push({ address: addr, lotNumber: dbEntry.lotNumber, status: "sold" })
    }
  }

  console.log(`  Diff — New/Updated: ${toIngest.filter(l => l.status === "active").length}, Sold: ${toIngest.filter(l => l.status === "sold").length}`)

  // ── Reconcile placeholder counts against Sheet Table 2 ──────────────────
  const sheetCounts = await fetchTable2Counts(SHEET_TAB)
  const commCounts  = sheetCounts[comm.name] || null
  if (commCounts) {
    const { toIngest: phIngest, removeIds } = reconcilePlaceholders(
      commCounts, db.placeholders, db.realActiveCount
    )
    toIngest.push(...phIngest)
    if (removeIds.length > 0) {
      await prisma.listing.updateMany({ where: { id: { in: removeIds } }, data: { status: "removed" } })
      console.log(`  Placeholders removed: ${removeIds.length}`)
    }
    if (phIngest.length > 0)
      console.log(`  Placeholders synced: +${phIngest.filter(l=>l.status==="sold").length} sold, +${phIngest.filter(l=>l.status==="active").length} avail, +${phIngest.filter(l=>l.status==="future").length} future`)
  }

  if (toIngest.length > 0) {
    await postIngest(comm, toIngest)
  } else {
    console.log("  No changes")
  }

  return { community: comm.name, changes: toIngest.length }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log("Del Webb Agent — Map-Based Scraper")
  console.log(`${new Date().toISOString()}`)
  console.log("=".repeat(60))

  const results = []
  for (const comm of COMMUNITIES) {
    try {
      const r = await processCommunity(comm)
      results.push(r)
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
