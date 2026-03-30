/**
 * Taylor Morrison OC Scraper  (diff-based)
 *
 * For each known OC community URL:
 *   1. Scrapes /available-homes and extracts the embedded JSON blob
 *   2. Queries DB for current active listings
 *   3. Diffs scraped vs DB:
 *      - New listings  → POST to ingest as "active"
 *      - Sold listings → POST to ingest as "sold"
 *      - Price changes → POST to ingest with updated price
 *   4. Only POSTs if something changed
 *
 * Run: node scripts/scrape-taylor-morrison.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local from project root (one level up from /scripts)
const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const BUILDER_NAME  = "Taylor Morrison"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const TM_COMMUNITIES = [
  {
    name: "Lily at Great Park Neighborhoods",
    city: "Irvine",
    state: "CA",
    url: "https://www.taylormorrison.com/ca/southern-california/irvine/lily-at-great-park-neighborhoods",
  },
  {
    name: "Ovata at Great Park Neighborhoods",
    city: "Irvine",
    state: "CA",
    url: "https://www.taylormorrison.com/ca/southern-california/irvine/ovata-at-great-park-neighborhoods",
  },
  {
    name: "Aurora at Luna Park",
    city: "Irvine",
    state: "CA",
    url: "https://www.taylormorrison.com/ca/southern-california/irvine/aurora-at-luna-park",
  },
  {
    name: "Viewpoint on Katella",
    city: "Orange",
    state: "CA",
    url: "https://www.taylormorrison.com/ca/southern-california/orange/viewpoint-on-katella",
  },
]

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr.replace(STREET_SUFFIXES, "").replace(/\s+/g, " ").trim()
}

function mapStatus(statusCode, sectionLabel) {
  const label = (sectionLabel || "").toLowerCase()
  if (label.includes("ready now"))        return "active"
  if (label.includes("quick move"))       return "active"
  if (label.includes("under construction")) return "active"
  if (label.includes("coming soon"))      return "coming_soon"
  const code = parseInt(statusCode, 10)
  if (code === 0) return "active"
  if (code === 1) return "reserved"
  if (code === 2) return "sold"
  if (code === 3) return "coming_soon"
  return "active"
}

// ─────────────────────────────────────────────────────────────
// DB helper: get active listings for a community
// ─────────────────────────────────────────────────────────────
async function getDbActive(communityName, builderName) {
  const listings = await prisma.listing.findMany({
    where: {
      status: "active",
      community: { name: communityName, builder: { name: builderName } },
    },
    select: { id: true, address: true, lotNumber: true, currentPrice: true },
  })
  return {
    byAddress:   new Map(listings.filter(l => l.address).map(l => [l.address, l])),
    byLotNumber: new Map(listings.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
  }
}

// ─────────────────────────────────────────────────────────────
// Ingest API call
// ─────────────────────────────────────────────────────────────
async function postIngest(payload) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-secret": INGEST_SECRET,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ingest API error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────
// Scrape available-homes page
// ─────────────────────────────────────────────────────────────
async function scrapeAvailableHomes(browser, community) {
  const availUrl = community.url + "/available-homes"
  console.log(`\n  Scraping: ${availUrl}`)

  const page = await browser.newPage()
  try {
    await page.goto(availUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(600)
    }

    const result = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"))
      const hit = scripts.find((s) => s.textContent.includes("availableHomesList"))
      if (!hit) return null

      try {
        const data = JSON.parse(hit.textContent)
        const sections = data.availableHomesList?.sections || []
        const allHomes = []
        for (const section of sections) {
          for (const home of (section.homes || [])) {
            allHomes.push({
              sectionLabel:       section.sectionLabel,
              address:            home.address        || null,
              homeSite:           home.homeSite        || null,
              floorPlan:          home.floorPlan       || null,
              sqft:               home.sqft            || null,
              bed:                home.bed             || null,
              totalBath:          home.totalBath       || null,
              garages:            home.garages         || null,
              price:              home.price           || null,
              hoaDues:            home.hoaDues         || null,
              readyDate:          home.readyDate       || null,
              availabilityStatus: home.availabilityStatus || null,
              isModelHome:        home.isModelHome     || false,
              homeReserved:       home.homeReserved    || false,
              viewHomeLink:       home.viewHomeLink?.Url || null,
            })
          }
        }
        return allHomes
      } catch (e) {
        return { error: e.message }
      }
    })

    if (!result) {
      console.log("  No availableHomesList script found on page")
      return []
    }
    if (result.error) {
      console.log(`  JSON parse error: ${result.error}`)
      return []
    }

    console.log(`  Found ${result.length} listings across all sections`)
    return result
  } catch (err) {
    console.warn(`  Warning: Failed to scrape ${availUrl}: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}

// ─────────────────────────────────────────────────────────────
// Process one community: scrape → diff → ingest
// ─────────────────────────────────────────────────────────────
async function processCommunity(browser, comm) {
  console.log(`\n${"─".repeat(50)}`)
  console.log(`Community: ${comm.name} (${comm.city}, ${comm.state})`)

  // 1. Scrape
  const homes = await scrapeAvailableHomes(browser, comm)

  // 2. Query DB for active listings
  const db = await getDbActive(comm.name, BUILDER_NAME)

  // Build lookup maps from scraped data
  // Key by address (normalized) and by lot number
  const scrapedByAddr   = new Map()
  const scrapedByLot    = new Map()

  for (const home of homes) {
    const rawAddr = (home.address || "").trim()
    if (rawAddr) scrapedByAddr.set(normalizeAddress(rawAddr), home)
    if (home.homeSite) scrapedByLot.set(String(home.homeSite), home)
  }

  // Ingest payload buckets
  const newListings     = []   // scraped, not in DB
  const priceChanges    = []   // in both, price differs
  const soldListings    = []   // in DB active, not in scraped

  // ── Detect new + price changes ──
  for (const home of homes) {
    const rawAddr    = (home.address || "").trim()
    const normAddr   = normalizeAddress(rawAddr)
    const lotStr     = home.homeSite ? String(home.homeSite) : null
    const price      = home.price ? parseInt(home.price, 10) : null
    const status     = home.homeReserved
      ? "reserved"
      : mapStatus(home.availabilityStatus, home.sectionLabel)
    const sourceUrl  = home.viewHomeLink
      ? `https://www.taylormorrison.com${home.viewHomeLink}`
      : comm.url + "/available-homes"

    // Look up in DB: prefer address match, fall back to lot
    let dbEntry = normAddr ? db.byAddress.get(normAddr) : null
    if (!dbEntry && lotStr) dbEntry = db.byLotNumber.get(lotStr)

    if (!dbEntry) {
      // New listing — send full minimal payload
      newListings.push({
        address:      rawAddr  || null,
        lotNumber:    home.homeSite || null,
        currentPrice: price,
        moveInDate:   home.readyDate || null,
        status,
        sourceUrl,
        // Full details for first ingest
        beds:      home.bed      != null ? parseFloat(home.bed)      : null,
        baths:     home.totalBath != null ? parseFloat(home.totalBath) : null,
        sqft:      home.sqft     ? parseInt(home.sqft, 10)            : null,
        garages:   home.garages  != null ? parseInt(home.garages, 10) : null,
        hoaFees:   home.hoaDues  != null ? parseInt(home.hoaDues, 10) : null,
        floorPlan: home.floorPlan || null,
      })
    } else if (price != null && dbEntry.currentPrice !== price) {
      // Price changed
      priceChanges.push({
        address:      rawAddr || null,
        lotNumber:    home.homeSite || null,
        currentPrice: price,
        moveInDate:   home.readyDate || null,
        status,
        sourceUrl,
      })
    }
  }

  // ── Detect sold (active in DB, not in scraped) ──
  for (const [normAddr, dbEntry] of db.byAddress.entries()) {
    // Check if this address appears in scraped results
    const inScraped = scrapedByAddr.has(normAddr)
    // Also check by lot number
    const byLot = dbEntry.lotNumber
      ? scrapedByLot.has(String(dbEntry.lotNumber))
      : false

    if (!inScraped && !byLot) {
      soldListings.push({
        address:   dbEntry.address,
        lotNumber: dbEntry.lotNumber || null,
        status:    "sold",
        sourceUrl: comm.url + "/available-homes",
      })
    }
  }

  // ── Log diff summary ──
  console.log(`  Diff — New: ${newListings.length}, Price changes: ${priceChanges.length}, Sold: ${soldListings.length}`)

  // ── POST to ingest if any changes ──
  const allChanges = [...newListings, ...priceChanges, ...soldListings]
  if (allChanges.length === 0) {
    console.log("  No changes — skipping ingest POST")
    return { community: comm.name, new: 0, priceChanges: 0, sold: 0 }
  }

  const payload = {
    builder:   BUILDER_NAME,
    community: {
      name:  comm.name,
      city:  comm.city,
      state: comm.state,
      url:   comm.url,
    },
    listings: allChanges,
  }

  console.log(`  POSTing ${allChanges.length} listing change(s) to ingest...`)
  try {
    const result = await postIngest(payload)
    console.log(`  Ingest response:`, JSON.stringify(result))
  } catch (err) {
    console.error(`  Ingest failed: ${err.message}`)
  }

  return {
    community:    comm.name,
    new:          newListings.length,
    priceChanges: priceChanges.length,
    sold:         soldListings.length,
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60))
  console.log("Taylor Morrison OC Scraper (diff-based)")
  console.log("=".repeat(60))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })

  const summary = []

  try {
    for (const comm of TM_COMMUNITIES) {
      const result = await processCommunity(context, comm)
      summary.push(result)
      await new Promise((r) => setTimeout(r, 1000))
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }

  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  for (const s of summary) {
    console.log(
      `${s.community}: ${s.new} new, ${s.priceChanges} price changes, ${s.sold} sold`
    )
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
