/**
 * KB Home Orange County Scraper  (diff-based)
 *
 * 1. Fetches real OC community list from window.regionMapData
 * 2. Fetches all Move-In Ready listing URLs from the MIR listing page
 * 3. Queries DB for current active listings per community
 * 4. Diffs scraped URLs vs DB:
 *    - New listings  → visit detail page, then POST to ingest as "active"
 *    - Sold listings → POST to ingest as "sold" (no detail page visit needed)
 *    - Price changes → detected from listing-page price vs DB price, POST update
 * 5. Only POSTs to ingest if changes exist
 *
 * Run: node scripts/scrape-kb-oc.mjs
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
const BUILDER_NAME  = "KB Home"

const BASE_URL      = "https://www.kbhome.com"
const OC_REGION_URL = `${BASE_URL}/new-homes-orange-county`
const MIR_LIST_URL  = `${BASE_URL}/move-in-ready?state=california&region=orange+county`
const USER_AGENT    =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const STREET_SUFFIXES =
  /\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr.replace(STREET_SUFFIXES, "").replace(/\s+/g, " ").trim()
}

function parsePriceInt(str) {
  if (!str) return null
  const n = parseInt(String(str).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(str) {
  if (!str) return null
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function parseIntSafe(str) {
  if (!str) return null
  const n = parseInt(String(str).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
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
// Step 1: Get OC communities from window.regionMapData
// ─────────────────────────────────────────────────────────────
async function getOCCommunities(browser) {
  console.log("\n[Step 1] Fetching OC communities from kbhome.com...")
  const page = await browser.newPage()
  await page.goto(OC_REGION_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(7000)

  const data = await page.evaluate(() => window.regionMapData)
  await page.close()

  if (!data || !data.communitiesData) {
    throw new Error("Could not find window.regionMapData on OC page")
  }

  // Filter to only genuine OC communities
  const ocCommunities = data.communitiesData.filter(
    (c) => c.PageUrl && c.PageUrl.startsWith("/new-homes-orange-county/")
  )

  // Deduplicate by CommunityId
  const seen   = new Set()
  const unique = ocCommunities.filter((c) => {
    if (seen.has(c.CommunityId)) return false
    seen.add(c.CommunityId)
    return true
  })

  console.log(`  Found ${unique.length} real OC communities:`)
  unique.forEach((c) =>
    console.log(`    - ${c.CommunityName} | ${c.City}, ${c.StateAbbreviation} | ${c.PageUrl}`)
  )
  return unique
}

// ─────────────────────────────────────────────────────────────
// Step 2: Scrape MIR listing page (get URLs + basic data)
// ─────────────────────────────────────────────────────────────
async function getMIRListings(browser) {
  console.log("\n[Step 2] Fetching OC Move-In Ready listings...")
  const page = await browser.newPage()
  await page.goto(MIR_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(8000)

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3000)

  const listings = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".content-inner"))
    return cards
      .map((card) => {
        const link   = card.querySelector("a[href*='/mir?homesite=']")
        const mirUrl = link?.getAttribute("href") || null

        const addressEl = card.querySelector("h2, h3, .address, [class*='address']")
        let address = addressEl?.innerText?.trim() || ""
        if (!address) {
          const lines = (card.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
          address = lines[0] || ""
        }

        const allText = (card.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
        let communityName = ""
        let cityState     = ""
        let price         = ""
        let beds          = ""
        let baths         = ""
        let sqft          = ""
        let garages       = ""

        allText.forEach((line, i) => {
          if (line.match(/^\$[\d,]+/)) price = line
          if (i === 1) communityName = line
          if (i === 2 && line.includes(",")) cityState = line
        })

        const detailsEl = card.querySelector(".details")
        if (detailsEl) {
          const detailText = detailsEl.innerText || ""
          const bedsM  = detailText.match(/([\d.]+)\s*BEDS/i)
          const bathsM = detailText.match(/([\d.]+)\s*BATHS/i)
          const sqftM  = detailText.match(/([\d,]+)\s*SQFT/i)
          const garM   = detailText.match(/([\d]+)\s*CARS/i)
          if (bedsM)  beds    = bedsM[1]
          if (bathsM) baths   = bathsM[1]
          if (sqftM)  sqft    = sqftM[1].replace(/,/g, "")
          if (garM)   garages = garM[1]
        }

        const hsM          = (card.innerText || "").match(/Homesite\s+(\w+)/i)
        const hotsiteLabel = hsM ? hsM[1] : ""
        const isAvailableNow = (card.innerText || "").includes("Available Now")

        return {
          address,
          communityName,
          cityState,
          price,
          beds,
          baths,
          sqft,
          garages,
          hotsiteLabel,
          isAvailableNow,
          mirUrl,
        }
      })
      .filter((l) => l.mirUrl && l.address)
  })

  await page.close()
  console.log(`  Found ${listings.length} MIR listings on the listing page`)
  return listings
}

// ─────────────────────────────────────────────────────────────
// Step 3: Visit a single MIR detail page (only for NEW listings)
// ─────────────────────────────────────────────────────────────
async function getMIRDetail(browser, mirPath) {
  const url  = `${BASE_URL}${mirPath}`
  const page = await browser.newPage()
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    const detail = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""

      const h1     = document.querySelector("h1, .homesite-address, [class*='address-heading']")
      const address = h1?.innerText?.trim().split("\n")[0] || ""

      const getMetric = (label) => {
        const re  = new RegExp(`([\\d.,]+)\\s*\\n\\s*${label}`, "i")
        const m   = bodyText.match(re)
        if (m) return m[1].replace(/,/g, "")
        const re2 = new RegExp(`([\\d.,]+)\\s*${label}`, "i")
        const m2  = bodyText.match(re2)
        return m2 ? m2[1].replace(/,/g, "") : null
      }

      const beds    = getMetric("BEDS")
      const baths   = getMetric("BATHS")
      const stories = getMetric("STORIES")
      const sqft    = getMetric("SQFT")
      const garages = getMetric("CARS")

      const priceM = bodyText.match(/\$\s*([\d,]+)/)
      const price  = priceM ? priceM[1].replace(/,/g, "") : null

      const communityLink = document.querySelector("a[href*='/new-homes-orange-county/']")
      const communityName = communityLink?.innerText?.trim() || ""

      const cityM = bodyText.match(/([A-Za-z\s]+),\s*CA\s+\d{5}/)
      const city  = cityM ? cityM[1].trim() : ""

      const hsM      = bodyText.match(/Homesite\s+(\w+)/i)
      const lotNumber = hsM ? hsM[1] : null

      const moveInM   = bodyText.match(
        /(?:move[- ]in|available|estimated[^:]*?:?)\s*([A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
      )
      const moveInDate = moveInM ? moveInM[1] : null

      const hoaM   = bodyText.match(/HOA[^$]*\$\s*([\d,]+)/i)
      const hoaFees = hoaM ? parseInt(hoaM[1].replace(/,/g, ""), 10) : null

      let propertyType = null
      if (bodyText.match(/condominium|condo/i))   propertyType = "Condo"
      else if (bodyText.match(/townhome|townhouse/i)) propertyType = "Townhome"
      else if (bodyText.match(/single.family/i))  propertyType = "Single Family"

      const isAvailableNow =
        bodyText.includes("AVAILABLE NOW") || bodyText.includes("Available Now")

      return {
        address,
        beds,
        baths,
        stories,
        sqft,
        garages,
        price,
        city,
        communityName,
        lotNumber,
        moveInDate,
        hoaFees,
        propertyType,
        isAvailableNow,
      }
    })

    return { url, ...detail }
  } catch (err) {
    console.warn(`  Warning: Failed to load ${url}: ${err.message}`)
    return null
  } finally {
    await page.close()
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60))
  console.log("KB Home Orange County Scraper (diff-based)")
  console.log("=".repeat(60))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })

  const summary = {
    communitiesFound: 0,
    mirListings:      0,
    detailPageVisits: 0,
    new:              0,
    priceChanges:     0,
    sold:             0,
  }

  try {
    // ── Step 1: Get OC communities ──
    const ocCommunities = await getOCCommunities(context)
    summary.communitiesFound = ocCommunities.length

    // Build community name → metadata map
    // CommunityName → { PageUrl, City, StateAbbreviation }
    const commMetaByName = new Map(
      ocCommunities.map((c) => [c.CommunityName.toLowerCase(), c])
    )

    // ── Step 2: Get MIR listing-page data ──
    const mirListings = await getMIRListings(context)
    summary.mirListings = mirListings.length

    // Group listing-page items by community name
    // communityName (lower) → [listing, ...]
    const mirByComm = new Map()
    for (const listing of mirListings) {
      if (!listing.communityName) continue
      const key = listing.communityName.toLowerCase()
      if (!mirByComm.has(key)) mirByComm.set(key, [])
      mirByComm.get(key).push(listing)
    }

    // ── Step 3 & 4: Per-community diff + ingest ──
    console.log("\n[Step 3] Diff per community and selectively visit detail pages...")

    for (const ocComm of ocCommunities) {
      const commNameLower = ocComm.CommunityName.toLowerCase()
      const communityUrl  = `${BASE_URL}${ocComm.PageUrl}`
      const city          = ocComm.City
      const state         = ocComm.StateAbbreviation || "CA"

      console.log(`\n${"─".repeat(50)}`)
      console.log(`Community: ${ocComm.CommunityName} (${city}, ${state})`)

      // Listings from the MIR listing page for this community
      // Try exact match first, then partial
      let pageListings = mirByComm.get(commNameLower) || []
      if (pageListings.length === 0) {
        // Partial match
        for (const [key, val] of mirByComm.entries()) {
          if (key.includes(commNameLower) || commNameLower.includes(key)) {
            pageListings = val
            break
          }
        }
      }

      console.log(`  Listing-page entries: ${pageListings.length}`)

      // Query DB active listings for this community
      const db = await getDbActive(ocComm.CommunityName, BUILDER_NAME)
      const dbActiveCount = db.byAddress.size
      console.log(`  DB active listings:   ${dbActiveCount}`)

      // Build a set of normalized addresses and lot numbers currently scraped
      const scrapedNormAddrs = new Set()
      const scrapedLots      = new Set()
      for (const pl of pageListings) {
        const norm = normalizeAddress(pl.address || "")
        if (norm) scrapedNormAddrs.add(norm)
        if (pl.hotsiteLabel) scrapedLots.add(pl.hotsiteLabel)
      }

      const newListings  = []  // need detail page visit
      const priceChanges = []  // listing-page price differs from DB
      const soldEntries  = []  // in DB, not on site

      // ── Classify each page listing ──
      for (const pl of pageListings) {
        const normAddr = normalizeAddress(pl.address || "")
        const lotStr   = pl.hotsiteLabel || null
        const pagePrice = parsePriceInt(pl.price)

        // Check DB
        let dbEntry = normAddr ? db.byAddress.get(normAddr) : null
        if (!dbEntry && lotStr) dbEntry = db.byLotNumber.get(lotStr)

        if (!dbEntry) {
          // New — need to visit detail page
          newListings.push(pl)
        } else if (pagePrice != null && dbEntry.currentPrice !== pagePrice) {
          // Price changed — no detail page needed
          const sourceUrl = `${BASE_URL}${pl.mirUrl}`
          priceChanges.push({
            address:      pl.address || null,
            lotNumber:    lotStr,
            currentPrice: pagePrice,
            moveInDate:   null,
            status:       "active",
            sourceUrl,
          })
        }
        // else: no change, skip
      }

      // ── Detect sold (active in DB, not in scraped) ──
      for (const [normAddr, dbEntry] of db.byAddress.entries()) {
        const inScraped = scrapedNormAddrs.has(normAddr)
        const byLot     = dbEntry.lotNumber
          ? scrapedLots.has(String(dbEntry.lotNumber))
          : false
        if (!inScraped && !byLot) {
          soldEntries.push({
            address:   dbEntry.address,
            lotNumber: dbEntry.lotNumber || null,
            status:    "sold",
            sourceUrl: communityUrl,
          })
        }
      }

      console.log(
        `  Diff — New: ${newListings.length}, Price changes: ${priceChanges.length}, Sold: ${soldEntries.length}`
      )

      // ── Visit detail pages only for NEW listings ──
      const newDetailedListings = []
      for (const pl of newListings) {
        if (!pl.mirUrl) continue
        console.log(`  Visiting detail page (new): ${pl.mirUrl}`)
        const detail = await getMIRDetail(context, pl.mirUrl)
        summary.detailPageVisits++

        if (detail) {
          // Merge listing-page data as fallback
          detail.communityName  = detail.communityName  || pl.communityName
          detail.city           = detail.city           || (pl.cityState?.split(",")[0]?.trim()) || city
          detail.beds           = detail.beds           || pl.beds
          detail.baths          = detail.baths          || pl.baths
          detail.sqft           = detail.sqft           || pl.sqft
          detail.garages        = detail.garages        || pl.garages
          detail.price          = detail.price          || pl.price?.replace(/[^0-9]/g, "")
          detail.isAvailableNow = detail.isAvailableNow || pl.isAvailableNow
          detail.mirPath        = pl.mirUrl

          const sourceUrl = `${BASE_URL}${pl.mirUrl}`
          newDetailedListings.push({
            address:      detail.address || pl.address || null,
            lotNumber:    detail.lotNumber || pl.hotsiteLabel || null,
            currentPrice: parsePriceInt(detail.price),
            moveInDate:   detail.moveInDate || null,
            status:       "active",
            sourceUrl,
            // Full details for first ingest
            beds:         parseFloatSafe(detail.beds),
            baths:        parseFloatSafe(detail.baths),
            sqft:         parseIntSafe(detail.sqft),
            floors:       parseIntSafe(detail.stories),
            garages:      parseIntSafe(detail.garages),
            hoaFees:      detail.hoaFees || null,
            propertyType: detail.propertyType || null,
          })
        }

        await new Promise((r) => setTimeout(r, 800))
      }

      // ── POST to ingest if any changes ──
      const allChanges = [...newDetailedListings, ...priceChanges, ...soldEntries]
      if (allChanges.length === 0) {
        console.log("  No changes — skipping ingest POST")
        continue
      }

      const payload = {
        builder:   BUILDER_NAME,
        community: {
          name:  ocComm.CommunityName,
          city,
          state,
          url:   communityUrl,
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

      summary.new          += newDetailedListings.length
      summary.priceChanges += priceChanges.length
      summary.sold         += soldEntries.length
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }

  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`OC communities found:   ${summary.communitiesFound}`)
  console.log(`MIR listings on page:   ${summary.mirListings}`)
  console.log(`Detail pages visited:   ${summary.detailPageVisits}  (new listings only)`)
  console.log(`New listings ingested:  ${summary.new}`)
  console.log(`Price changes ingested: ${summary.priceChanges}`)
  console.log(`Sold listings ingested: ${summary.sold}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
