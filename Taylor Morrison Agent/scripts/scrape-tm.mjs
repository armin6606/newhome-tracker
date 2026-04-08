/**
 * Taylor Morrison Agent — Map-Based Diff Scraper
 *
 * Map source: Firebase Storage payload.json (publicly readable, no auth needed)
 * URL: https://firebasestorage.googleapis.com/v0/b/taylor-morrison-vu.appspot.com/o/siteplan%2F{id}%2Fpayload.json?alt=media
 *
 * Lot statuses in payload:
 *   "inventory"    → For Sale (active)
 *   "future-phase" → Future Release
 *   "sales-model"  → Model (not for sale)
 *   "reserved"     → Reserved
 *   (absent)       → Sold (sold lots are removed from payload)
 *
 * Logic:
 *   1. Fetch Firebase payload → identify "inventory" lots (for-sale) with addresses
 *   2. Diff against DB active listings:
 *      - New for-sale → scrape price from TM available-homes page (Playwright)
 *      - DB active but not in payload → mark sold
 *      - Price changed → update price
 *
 * Siteplan ID extraction: fetch TM community HTML, find tm-vu.com/siteplan/{id} pattern
 *
 * Run: node "Taylor Morrison Agent/scripts/scrape-tm.mjs"
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"
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

const BUILDER_NAME   = "Taylor Morrison"
const SHEET_TAB      = "Taylor Communities"
const BUILDER_URL    = "https://www.taylormorrison.com"
const INGEST_URL     = "https://www.newkey.us/api/ingest"
const INGEST_SECRET  = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const FIREBASE_BASE  = "https://firebasestorage.googleapis.com/v0/b/taylor-morrison-vu.appspot.com/o"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// sitePlanId is from tm-vu.com/siteplan/{id} — found in TM community page HTML
// To add a new community: scrape the community page and find the tm-vu.com/siteplan/ URL
const TM_COMMUNITIES = [
  {
    name:       "Lily at Great Park Neighborhoods",
    city:       "Irvine",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/irvine/lily-at-great-park-neighborhoods",
    sitePlanId: "eG0ANDvvjvZWfrIhS50v",
  },
  {
    name:       "Ovata at Great Park Neighborhoods",
    city:       "Irvine",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/irvine/ovata-at-great-park-neighborhoods",
    sitePlanId: "du3a1hiY7m2zIcG0csX7",
  },
  {
    name:       "Aurora at Luna Park",
    city:       "Irvine",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/irvine/aurora-at-luna-park",
    sitePlanId: "60weSMjhMgrn8CfuaT2S",
  },
  {
    name:       "Oliva",
    city:       "French Valley",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/french-valley/oliva-at-siena",
    sitePlanId: "ujusiGpCy39rSTvDbfcm",
  },
  {
    name:       "Juniper",
    city:       "Moreno Valley",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/moreno-valley/juniper-at-alessandro",
    sitePlanId: "Rdce5w2qvXwtuG5oqpL6",
  },
  {
    name:       "Cobalt",
    city:       "Moreno Valley",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/moreno-valley/cobalt-at-alessandro",
    sitePlanId: "7EgWmt3YHNI0oU8NYRh9",
  },
  {
    name:       "Indigo",
    city:       "Moreno Valley",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/moreno-valley/indigo-at-alessandro",
    sitePlanId: "kZOPlKofI3Byt3EIkSFJ",
  },
  {
    name:       "Viewpoint on Katella",
    city:       "Orange",
    state:      "CA",
    url:        "https://www.taylormorrison.com/ca/southern-california/orange/viewpoint-on-katella",
    sitePlanId: "qIu2n634l2lBiK5tGEQG__",
  },
]

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

// ─── Address helpers ─────────────────────────────────────────────────────────

const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")           // strip ", City, State ZIP"
    .replace(STREET_SUFFIXES, "")  // strip suffix
    .replace(/\s+/g, " ")
    .trim()
}

// ─── Firebase Payload ────────────────────────────────────────────────────────

async function fetchPayload(sitePlanId) {
  const encoded = encodeURIComponent(`siteplan/${sitePlanId}/payload.json`)
  const url = `${FIREBASE_BASE}/${encoded}?alt=media`
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) throw new Error(`Firebase ${res.status} for sitePlanId ${sitePlanId}`)
  return res.json()
}

function extractLotsFromPayload(data) {
  const segments = data.site?.segments || {}
  return Object.values(segments).map(seg => ({
    status:    seg.status,            // "inventory", "future-phase", "sales-model", "reserved"
    address:   cleanAddress(seg.address || ""),
    lotName:   seg.lotName || null,   // "Lot 24"
    homeUID:   seg.homeUID || null,
  }))
}

// ─── Scrape available-homes page for pricing ─────────────────────────────────

async function scrapeAvailableHomes(browser, community) {
  const availUrl = community.url + "/available-homes"
  const page = await browser.newPage()
  try {
    await page.goto(availUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(500)
    }

    const homes = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"))
      const hit = scripts.find(s => s.textContent.includes("availableHomesList"))
      if (!hit) return []
      try {
        const data = JSON.parse(hit.textContent)
        const allHomes = []
        for (const section of (data.availableHomesList?.sections || [])) {
          for (const home of (section.homes || [])) {
            allHomes.push({
              address:   home.address   || null,
              homeSite:  home.homeSite  || null,
              price:     home.price     || null,
              readyDate: home.readyDate || null,
              viewHomeLink: home.viewHomeLink?.Url || null,
              isModelHome:  home.isModelHome || false,
              floorPlan: home.floorPlan || null,
              sqft:      home.sqft      || null,
              beds:      home.bed       || null,
              baths:     home.totalBath || null,
              garages:   home.garages   || null,
            })
          }
        }
        return allHomes
      } catch { return [] }
    })
    return homes
  } catch (e) {
    console.warn(`  availableHomes scrape failed: ${e.message}`)
    return []
  } finally {
    await page.close()
  }
}

// ─── DB helper ───────────────────────────────────────────────────────────────

async function getDbActive(communityName) {
  const listings = await prisma.listing.findMany({
    where: { community: { name: communityName, builder: { name: BUILDER_NAME } } },
    select: { id: true, address: true, lotNumber: true, currentPrice: true, status: true },
  })
  const active = listings.filter(l => l.status === "active")
  return {
    byAddress:    new Map(active.filter(l => l.address).map(l => [l.address, l])),
    byLot:        new Map(active.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
    placeholders: {
      sold:   listings.filter(l => l.status === "sold"   && /^sold-\d+$/.test(l.lotNumber ?? "")),
      avail:  listings.filter(l => l.status === "active" && /^avail-\d+$/.test(l.lotNumber ?? "")),
      future: listings.filter(l => l.status === "future" && /^future-\d+$/.test(l.lotNumber ?? "")),
    },
    realActiveCount: active.filter(l => l.address && !/^avail-\d+$/.test(l.lotNumber ?? "")).length,
  }
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

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

// ─── Process one community ────────────────────────────────────────────────────

async function processCommunity(browser, comm) {
  comm = { ...comm, name: await resolveDbCommunityName(comm.name, BUILDER_NAME, prisma) }
  console.log(`\n${"─".repeat(50)}`)
  console.log(`${comm.name}`)

  // 1. Firebase map: lot statuses
  const allLots     = await fetchLotsFromPayload(comm.sitePlanId)
  const forSaleLots = allLots.filter(l => l.status === "inventory")

  console.log(`  Map: ${forSaleLots.length} for-sale (inventory), ${allLots.length} total lots in payload`)

  // 2. DB active listings
  const db = await getDbActive(comm.name)

  // 3. Check if anything changed
  const mapByAddr = new Map(forSaleLots.filter(l => l.address).map(l => [l.address, l]))
  const mapByLot  = new Map(forSaleLots.filter(l => l.lotName).map(l => [l.lotName, l]))

  // Find newly sold: active in DB but no longer in payload as "inventory"
  const soldListings = []
  for (const [addr, dbEntry] of db.byAddress.entries()) {
    const stillForSale = mapByAddr.has(addr)
      || (dbEntry.lotNumber && mapByLot.has(dbEntry.lotNumber))
    if (!stillForSale) {
      console.log(`  - Sold: ${addr}`)
      soldListings.push({ address: addr, lotNumber: dbEntry.lotNumber, status: "sold" })
    }
  }

  // Find new for-sale lots (in payload as "inventory" but not in DB)
  const newLots = []
  for (const lot of forSaleLots) {
    const dbEntry = (lot.address && db.byAddress.get(lot.address))
      || (lot.lotName && db.byLot.get(lot.lotName))
    if (!dbEntry) {
      newLots.push(lot)
    }
  }

  console.log(`  Diff — New for-sale: ${newLots.length}, Sold: ${soldListings.length}`)

  if (newLots.length === 0 && soldListings.length === 0) {
    // Check for price changes on existing lots
    // (need to scrape prices even if no new lots)
    const existingForSale = forSaleLots.filter(l => {
      const dbEntry = (l.address && db.byAddress.get(l.address))
        || (l.lotName && db.byLot.get(l.lotName))
      return dbEntry !== undefined
    })
    if (existingForSale.length === 0) {
      console.log("  No changes")
      return { community: comm.name, changes: 0 }
    }
  }

  // 4. Scrape availableHomesList for prices (only if we have new lots or need price checks)
  const availHomes = await scrapeAvailableHomes(browser, comm)

  // Build price lookup by cleaned address
  const priceByAddr = new Map()
  for (const home of availHomes) {
    if (home.isModelHome) continue
    const addr = cleanAddress(home.address || "")
    if (!addr) continue
    const price  = home.price ? parseInt(String(home.price).replace(/\D/g, "")) || null : null
    const srcUrl = home.viewHomeLink
      ? `${BUILDER_URL}${home.viewHomeLink}`
      : comm.url + "/available-homes"
    priceByAddr.set(addr, { price, readyDate: home.readyDate, sourceUrl: srcUrl, floorPlan: home.floorPlan || null, sqft: home.sqft || null, beds: home.beds || null, baths: home.baths || null, garages: home.garages || null })
  }

  const toIngest = [...soldListings]

  // New lots
  for (const lot of newLots) {
    const pricing = (lot.address && priceByAddr.get(lot.address)) || null
    const price   = pricing?.price ?? null
    const srcUrl  = pricing?.sourceUrl ?? comm.url + "/available-homes"
    console.log(`  + New: ${lot.address || lot.lotName} $${price?.toLocaleString() ?? "TBD"}`)
    toIngest.push({
      address:      lot.address,
      lotNumber:    lot.lotName ? compositeKey(comm.name, lot.lotName) : null,
      currentPrice: price,
      moveInDate:   pricing?.readyDate || null,
      status:       "active",
      sourceUrl:    srcUrl,
      floorPlan:    pricing?.floorPlan  || null,
      sqft:         pricing?.sqft       || null,
      beds:         pricing?.beds       || null,
      baths:        pricing?.baths      || null,
      garages:      pricing?.garages    || null,
    })
  }

  // Price changes on existing lots
  for (const lot of forSaleLots) {
    if (newLots.includes(lot)) continue
    const dbEntry = (lot.address && db.byAddress.get(lot.address))
      || (lot.lotName && db.byLot.get(lot.lotName))
    if (!dbEntry) continue
    const pricing = (lot.address && priceByAddr.get(lot.address)) || null
    const price   = pricing?.price ?? null
    if (price !== null && dbEntry.currentPrice !== price) {
      console.log(`  ~ Price: ${lot.address} $${dbEntry.currentPrice?.toLocaleString()} → $${price.toLocaleString()}`)
      toIngest.push({
        address:      lot.address,
        lotNumber:    lot.lotName ? compositeKey(comm.name, lot.lotName) : null,
        currentPrice: price,
        moveInDate:   pricing?.readyDate || null,
        status:       "active",
        sourceUrl:    pricing?.sourceUrl || comm.url,
      })
    }
  }

  // ── Reconcile placeholder counts against Sheet Table 2 ─────────────────
  const sheetCounts  = await fetchTable2Counts(SHEET_TAB)
  const commCounts   = sheetCounts[comm.name] || sheetCounts[comm.name.split(" at ")[0]] || null
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

  // Build observedPrices map for validation (address → price from available-homes page)
  const observedPrices = new Map()
  for (const [addr, pricing] of priceByAddr.entries()) {
    if (pricing.price != null) observedPrices.set(addr, pricing.price)
  }

  if (toIngest.length > 0) await postIngest(comm, toIngest)
  else console.log("  No changes")

  await validatePriceSync(comm.name, observedPrices)

  return { community: comm.name, changes: toIngest.length }
}

// ─── Validation ───────────────────────────────────────────────────────────────

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

async function fetchLotsFromPayload(sitePlanId) {
  const data = await fetchPayload(sitePlanId)
  return extractLotsFromPayload(data)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log("Taylor Morrison Agent — Map-Based Scraper")
  console.log(`${new Date().toISOString()}`)
  console.log("=".repeat(60))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })

  const results = []
  try {
    for (const comm of TM_COMMUNITIES) {
      try {
        results.push(await processCommunity(context, comm))
      } catch (e) {
        console.error(`  ERROR processing ${comm.name}: ${e.message}`)
        results.push({ community: comm.name, error: e.message })
      }
      await new Promise(r => setTimeout(r, 1000))
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }

  console.log("\n" + "=".repeat(60))
  console.log("DONE")
  for (const r of results) {
    if (r.error) console.log(`  ${r.community}: ERROR — ${r.error}`)
    else console.log(`  ${r.community}: ${r.changes} change(s)`)
  }
}

main().catch(e => { console.error("Fatal:", e); prisma.$disconnect(); process.exit(1) })
