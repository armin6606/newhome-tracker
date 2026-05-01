/**
 * Shea Homes Orange County Scraper — diff-based
 *
 * 1. For each community, scrape the available-homes page (QMI section).
 * 2. Query DB for current active listings.
 * 3. Diff: new → ingest, sold → mark sold, price changed → update price.
 * 4. Only POST to ingest if changes exist.
 * 5. Full detail only sent for new listings.
 *
 * Run: node scripts/scrape-shea.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const BUILDER_NAME  = "Shea Homes"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const SHEA_COMMUNITIES = [
  {
    name:  "Arbor at Portola Springs Village",
    city:  "Irvine",
    state: "CA",
    url:   "https://www.sheahomes.com/new-homes/california/orange-county/irvine/arbor-at-portola-springs-village",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/arbor-at-portola-springs-village?qmi-tab-select#available-homes",
  },
  {
    name:  "Arrowleaf",
    city:  "Rancho Mission Viejo",
    state: "CA",
    url:   "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/arrowleaf",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/arrowleaf?qmi-tab-select#available-homes",
  },
  {
    name:  "Bloom at Rienda",
    city:  "Rancho Mission Viejo",
    state: "CA",
    url:   "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/bloom-at-rienda",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/bloom-at-rienda?qmi-tab-select#available-homes",
  },
  {
    name:  "Cielo at Portola Springs Village",
    city:  "Irvine",
    state: "CA",
    url:   "https://www.sheahomes.com/new-homes/california/orange-county/irvine/cielo-at-portola-springs-village",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/cielo-at-portola-springs-village?qmi-tab-select#available-homes",
  },
  {
    name:  "Crestview",
    city:  "Irvine",
    state: "CA",
    url:   "https://www.sheahomes.com/new-homes/california/orange-county/irvine/crestview",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/crestview?qmi-tab-select#available-homes",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parsePriceFromText(text) {
  const m = text.match(/\$([0-9,]+)/)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ""), 10)
  return isNaN(n) || n < 50000 ? null : n
}

function parseIntFromText(text) {
  if (!text) return null
  const n = parseInt(String(text).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatFromText(text) {
  if (!text) return null
  const n = parseFloat(String(text).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(/\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// DB helper: get active listings indexed by address and lotNumber
// ---------------------------------------------------------------------------
async function getDbActive(communityName, builderName) {
  const listings = await prisma.listing.findMany({
    where: {
      status:    "active",
      community: { name: communityName, builder: { name: builderName } },
    },
    select: { id: true, address: true, lotNumber: true, currentPrice: true },
  })
  return {
    byAddress:   new Map(listings.filter(l => l.address).map(l => [l.address, l])),
    byLotNumber: new Map(listings.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
  }
}

// ---------------------------------------------------------------------------
// Parse a home card from its flattened innerText
// ---------------------------------------------------------------------------
function parseHomeCard(rawText, sourceUrl) {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)

  let homesite = null
  let address  = null
  let plan     = null
  let price    = null
  let sqft     = null
  let beds     = null
  let baths    = null
  let floors   = null
  let isSold   = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^(save to favorites|home tour|view home details|recently sold|home is sold|move-in now|car garage|\d+ photos?)$/i.test(line)) {
      if (/recently sold|home is sold/i.test(line)) isSold = true
      continue
    }

    if (/^Homesite\s+\d+/i.test(line)) {
      homesite = line.match(/\d+/)[0]
      continue
    }

    if (/^Plan\s+\w+$/i.test(line)) {
      plan = line
      continue
    }

    if (/Priced From/i.test(line)) {
      price = parsePriceFromText(line)
      continue
    }

    if (/^Sq\.?\s*Ft\.?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d,]+$/.test(prev)) sqft = parseIntFromText(prev)
      continue
    }

    if (/^Story$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^\d+$/.test(prev)) floors = parseInt(prev, 10)
      continue
    }

    if (/^Bedrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) beds = parseFloatFromText(prev)
      continue
    }

    if (/^Bathrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) baths = parseFloatFromText(prev)
      continue
    }

    if (!address && homesite && !plan) {
      if (/^\d+\s+[A-Za-z]/.test(line) && line.length < 60 && !line.includes("$")) {
        address = line
      }
    }
  }

  if (isSold) return null
  if (!homesite && !address) return null

  return { homesite, address: address || null, plan, price, sqft, beds, baths, floors, sourceUrl }
}

// ---------------------------------------------------------------------------
// Scrape a single community's available homes page
// ---------------------------------------------------------------------------
async function scrapeAvailableHomesPage(context, community) {
  console.log(`\n  Scraping: ${community.name}`)
  const page     = await context.newPage()
  const listings = []

  try {
    await page.goto(community.availableHomesUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(2000)

    const qmiInfo = await page.evaluate(() => {
      const text = document.body?.innerText || ""
      return {
        qmiCount:      (text.match(/Quick Move-ins?\s*\((\d+)\)/i) || [])[1] || null,
        hasQmiSection: !!document.querySelector("section.quick-move-in"),
      }
    })

    console.log(`    QMI count: ${qmiInfo.qmiCount ?? "unknown"} | QMI section: ${qmiInfo.hasQmiSection}`)

    if (!qmiInfo.hasQmiSection) {
      console.log("    No QMI section — community may have no available homes")
      return listings
    }

    const rawCards = await page.evaluate(() => {
      const qmiSection = document.querySelector("section.quick-move-in")
      if (!qmiSection) return []

      const titleLinks    = Array.from(qmiSection.querySelectorAll("a.home-card_content-title"))
      const homesiteLinks = titleLinks.filter(a => a.href && a.href.includes("homesite"))

      return homesiteLinks.map(a => {
        let el = a
        for (let i = 0; i < 10; i++) {
          el = el.parentElement
          if (!el) break
          const text = el.innerText || ""
          if (text.includes("Sq. Ft.") || text.includes("Bedrooms")) break
        }
        return { href: a.href, rawText: el ? el.innerText : a.innerText }
      })
    })

    console.log(`    Found ${rawCards.length} homesite card(s)`)

    for (const card of rawCards) {
      const parsed = parseHomeCard(card.rawText, card.href)
      if (!parsed) {
        console.log(`    Skipped sold/invalid card (href: ${card.href})`)
        continue
      }
      console.log(`    Card: HS${parsed.homesite} "${parsed.address}" ${parsed.plan} $${parsed.price?.toLocaleString() ?? "N/A"} ${parsed.sqft}sqft ${parsed.beds}bd ${parsed.baths}ba`)
      listings.push(parsed)
    }
  } catch (err) {
    console.warn(`    Error scraping ${community.name}: ${err.message}`)
  } finally {
    await page.close()
  }

  return listings
}

// ---------------------------------------------------------------------------
// POST to ingest endpoint
// ---------------------------------------------------------------------------
async function postIngest(payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(INGEST_URL, {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-ingest-secret": INGEST_SECRET,
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(`Ingest error ${res.status}: ${JSON.stringify(json)}`)
      return json
    } catch (err) {
      if (attempt === retries) throw err
      console.log(`  Ingest attempt ${attempt} failed (${err.message}) — retrying in 3s...`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

// ---------------------------------------------------------------------------
// Append this builder's result to the shared CI results file
// ---------------------------------------------------------------------------
function appendResultsFile(builderName, communityCount, errors) {
  try {
    const path = "/tmp/scrape-results.json"
    let existing = {}
    try { existing = JSON.parse(readFileSync(path, "utf8")) } catch {}
    existing[builderName] = {
      status:      errors.length === 0 ? "success" : "failure",
      communities: communityCount,
      errorCount:  errors.length,
      errors:      errors.slice(0, 3),
    }
    writeFileSync(path, JSON.stringify(existing))
    console.log(`Wrote CI results for ${builderName}`)
  } catch (e) {
    console.warn("Could not write /tmp/scrape-results.json:", e.message)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Shea Homes Orange County Scraper (diff-based)")
  console.log("=".repeat(60))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  const communityErrors = []

  try {
    for (const commDef of SHEA_COMMUNITIES) {
      console.log(`\n${"─".repeat(60)}`)
      console.log(`Community: ${commDef.name}`)

      // Scrape current available homes
      const scraped = await scrapeAvailableHomesPage(context, commDef)
      console.log(`  Scraped: ${scraped.length}`)

      // Query DB for current active listings
      const db = await getDbActive(commDef.name, BUILDER_NAME)
      console.log(`  DB active by address: ${db.byAddress.size} | by lot: ${db.byLotNumber.size}`)

      const newListings  = []
      const priceUpdates = []
      const soldListings = []

      // Index scraped by address and by lotNumber
      const scrapedByAddress = new Map()
      const scrapedByLot     = new Map()

      for (const item of scraped) {
        const lotNumber = item.homesite ? String(item.homesite).padStart(4, "0") : null
        let   rawAddr   = item.address || (lotNumber ? `Homesite ${lotNumber}` : null)
        if (!rawAddr) continue
        const address = normalizeAddress(rawAddr.trim())
        if (!address || address.length < 3) continue

        scrapedByAddress.set(address, { ...item, address, lotNumber })
        if (lotNumber) scrapedByLot.set(lotNumber, { ...item, address, lotNumber })
      }

      // Detect new and price-changed
      for (const [address, item] of scrapedByAddress) {
        const price   = item.price || null
        const lotNumber = item.lotNumber

        // Try match by address first, then by lot
        let dbEntry = db.byAddress.get(address)
        if (!dbEntry && lotNumber) dbEntry = db.byLotNumber.get(lotNumber)

        if (!dbEntry) {
          // New listing — send full detail
          newListings.push({
            address,
            lotNumber:    item.lotNumber || null,
            currentPrice: price,
            moveInDate:   item.moveInDate || null,
            status:       "active",
            sourceUrl:    item.sourceUrl || null,
            floorPlan:    item.plan || null,
            sqft:         item.sqft || null,
            beds:         item.beds || null,
            baths:        item.baths || null,
            floors:       item.floors || null,
            pricePerSqft: price && item.sqft ? Math.round(price / item.sqft) : null,
          })
        } else if (price && dbEntry.currentPrice !== price) {
          // Price changed — minimal payload
          priceUpdates.push({
            address,
            currentPrice: price,
            status:       "active",
            sourceUrl:    item.sourceUrl || null,
          })
        }
      }

      // Detect sold (active in DB but not scraped)
      for (const [addr, dbEntry] of db.byAddress) {
        const inScraped    = scrapedByAddress.has(addr)
        const lotInScraped = dbEntry.lotNumber ? scrapedByLot.has(dbEntry.lotNumber) : false
        if (!inScraped && !lotInScraped) {
          soldListings.push({ address: addr, status: "sold", soldAt: new Date().toISOString() })
        }
      }

      console.log(`  New: ${newListings.length} | Price changes: ${priceUpdates.length} | Sold: ${soldListings.length}`)

      const hasChanges = newListings.length > 0 || priceUpdates.length > 0 || soldListings.length > 0
      if (!hasChanges) {
        console.log("  No changes — skipping ingest POST")
        await new Promise(r => setTimeout(r, 2000))
        continue
      }

      const payload = {
        builder:   { name: BUILDER_NAME, websiteUrl: "https://www.sheahomes.com" },
        community: { name: commDef.name, city: commDef.city, state: commDef.state, url: commDef.url },
        listings:  [...newListings, ...priceUpdates, ...soldListings],
      }

      console.log(`  POSTing ${payload.listings.length} listing(s) to ingest...`)
      try {
        const result = await postIngest(payload)
        console.log("  Ingest result:", result)
      } catch (err) {
        console.error("  Ingest failed:", err.message)
        communityErrors.push(`${commDef.name}: ingest failed — ${err.message}`)
      }

      await new Promise(r => setTimeout(r, 2000))
    }
  } catch (err) {
    communityErrors.push(`Fatal: ${err.message}`)
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }

  appendResultsFile("Shea Homes", SHEA_COMMUNITIES.length, communityErrors)

  console.log("\n" + "=".repeat(60))
  console.log("Done.")
  console.log("=".repeat(60))
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
