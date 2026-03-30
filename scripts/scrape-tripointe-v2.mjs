/**
 * TRI Pointe Homes v2 Scraper — diff-based
 *
 * 1. For each community page, decode RSC __next_f data to extract plan/MIR homes.
 * 2. Query DB for current active listings.
 * 3. Diff: new → ingest, sold → mark sold, price changed → update price.
 * 4. Only POST to ingest if changes exist.
 * 5. Full detail only fetched for new homes (MIR); plans use card data directly.
 *
 * Run: node scripts/scrape-tripointe-v2.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
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
const BUILDER_NAME  = "TRI Pointe Homes"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
const BASE_URL      = "https://www.tripointehomes.com"

const KNOWN_COMMUNITIES = [
  {
    name: "Lavender at Rancho Mission Viejo",
    slug: "lavender-at-rancho-mission-viejo",
    url:  `${BASE_URL}/ca/orange-county/lavender-at-rancho-mission-viejo`,
    city: "Rancho Mission Viejo",
    state: "CA",
  },
  {
    name: "Heatherly at Rancho Mission Viejo",
    slug: "heatherly-at-rancho-mission-viejo",
    url:  `${BASE_URL}/ca/orange-county/heatherly-at-rancho-mission-viejo`,
    city: "Rancho Mission Viejo",
    state: "CA",
  },
  {
    name: "Naya at Luna Park",
    slug: "naya-at-luna-park",
    url:  `${BASE_URL}/ca/orange-county/naya-at-luna-park`,
    city: "Irvine",
    state: "CA",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parsePriceInt(val) {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseIntSafe(val) {
  if (val == null) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (val == null) return null
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
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
// RSC extraction (kept from v1)
// ---------------------------------------------------------------------------
function extractHitsFromRsc(allRscData) {
  const initIdx = allRscData.indexOf('initialData\\":{\\"hits\\":')
  if (initIdx === -1) return []

  const chunkStart = allRscData.lastIndexOf('self.__next_f.push([1,"', initIdx)
  if (chunkStart === -1) return []

  let i = chunkStart + 'self.__next_f.push([1,'.length
  while (i < allRscData.length && allRscData[i] !== '"') i++
  i++

  let rawStr = ""
  let j = i
  while (j < allRscData.length) {
    if (allRscData[j] === "\\") {
      rawStr += allRscData[j] + (allRscData[j + 1] || "")
      j += 2
    } else if (allRscData[j] === '"') {
      break
    } else {
      rawStr += allRscData[j]
      j++
    }
  }

  let decoded
  try {
    decoded = JSON.parse('"' + rawStr + '"')
  } catch (e) {
    console.log("  RSC decode error:", e.message?.slice(0, 60))
    return []
  }

  const propsMarker = '[false,["$","$L46",null,'
  const propsMarkerIdx = decoded.indexOf(propsMarker)
  if (propsMarkerIdx === -1) return []

  const propsStart = propsMarkerIdx + propsMarker.length
  if (decoded[propsStart] !== "{") return []

  let depth = 1
  let k = propsStart + 1
  while (k < decoded.length && depth > 0) {
    if (decoded[k] === "{") depth++
    else if (decoded[k] === "}") depth--
    k++
  }
  const propsStr = decoded.slice(propsStart, k)

  try {
    const props = JSON.parse(propsStr)
    return props?.initialData?.hits || []
  } catch (e) {
    console.log("  Props parse error:", e.message?.slice(0, 60))
    return []
  }
}

// ---------------------------------------------------------------------------
// Scrape community page — returns array of { type, address, price, ... }
// ---------------------------------------------------------------------------
async function scrapeCommunityPlans(page, comm) {
  console.log(`\n  Scraping: ${comm.url}`)
  await page.goto(comm.url + "/", { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(4000)

  const initialRscData = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("script:not([src])"))
      .filter(s => s.textContent?.trim().startsWith("self.__next_f.push"))
      .map(s => s.textContent?.trim())
      .join("\n")
  })

  const initialHits = extractHitsFromRsc(initialRscData)
  console.log(`  RSC hits (initial): ${initialHits.length}`)

  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 700))
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1500)

  const loadMoreClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button"))
      .find(b => b.textContent?.trim().toLowerCase() === "load more")
    if (btn) { btn.click(); return true }
    return false
  })
  if (loadMoreClicked) {
    await page.waitForTimeout(3000)
    console.log("  Clicked Load More")
  }

  // DOM plans
  const domPlans = await page.evaluate(({ commSlug, baseUrl }) => {
    const plans = []
    const seen  = new Set()
    document.querySelectorAll("a[href]").forEach(el => {
      const href = el.getAttribute("href") || ""
      const planMatch = href.match(new RegExp(`/ca/orange-county/${commSlug}/(plan-[^/]+)/?$`))
      if (!planMatch) return
      const planSlug = planMatch[1]
      if (seen.has(planSlug)) return
      seen.add(planSlug)

      const card  = el.closest("article, li, [class*=\"card\"], [class*=\"Card\"], [class*=\"item\"], [class*=\"Item\"]") || el.parentElement || el
      const text  = (card?.textContent || el.textContent || "").replace(/\s+/g, " ").trim()
      const slugM = planSlug.match(/^plan-([^-]+)/i)
      const planName = slugM ? `Plan ${slugM[1].toUpperCase()}` : planSlug

      const priceM   = text.match(/\$([\d,]+)/)
      const bedsM    = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const bathsM   = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const sqftM    = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      const garM     = text.match(/([\d]+)\s*BAY\s*GARAGE/i)
      const storiesM = text.match(/([\d]+)\s*STORIE?S?/i)

      let status = "active"
      if (/coming\s*soon/i.test(text)) status = "coming-soon"
      else if (/limited\s*availability/i.test(text)) status = "limited"

      plans.push({
        planSlug,
        planName,
        price:    priceM   ? parseInt(priceM[1].replace(/,/g, ""), 10) : null,
        beds:     bedsM    ? parseFloat(bedsM[1]) : null,
        baths:    bathsM   ? parseFloat(bathsM[1]) : null,
        sqft:     sqftM    ? parseInt((sqftM[2] || sqftM[1]).replace(/,/g, ""), 10) : null,
        garages:  garM     ? parseInt(garM[1], 10) : null,
        floors:   storiesM ? parseInt(storiesM[1], 10) : null,
        status,
        sourceUrl: `${baseUrl}/ca/orange-county/${commSlug}/${planSlug}`,
      })
    })
    return plans
  }, { commSlug: comm.slug, baseUrl: BASE_URL })

  console.log(`  DOM plans: ${domPlans.length}`)

  // MIR homes (address slugs starting with digit)
  const mirHomes = await page.evaluate(({ commSlug, baseUrl }) => {
    const homes = []
    const seen  = new Set()
    document.querySelectorAll("a[href]").forEach(el => {
      const href = el.getAttribute("href") || ""
      const mirMatch = href.match(new RegExp(`/ca/orange-county/${commSlug}/(\\d[^/]+)/?$`))
      if (!mirMatch) return
      const addrSlug = mirMatch[1]
      if (seen.has(addrSlug)) return
      seen.add(addrSlug)

      const card  = el.closest("article, li, [class*=\"card\"], [class*=\"Card\"], [class*=\"item\"], [class*=\"Item\"]") || el.parentElement || el
      const text  = (card?.textContent || el.textContent || "").replace(/\s+/g, " ").trim()
      let address = addrSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      address = address.replace(/\s+(Way|Street|St|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)$/i, "")

      const priceM = text.match(/\$([\d,]+)/)
      const bedsM  = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const bathsM = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const sqftM  = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      const garM   = text.match(/([\d]+)\s*BAY\s*GARAGE/i)

      homes.push({
        address,
        price:    priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null,
        beds:     bedsM  ? parseFloat(bedsM[1]) : null,
        baths:    bathsM ? parseFloat(bathsM[1]) : null,
        sqft:     sqftM  ? parseInt((sqftM[2] || sqftM[1]).replace(/,/g, ""), 10) : null,
        garages:  garM   ? parseInt(garM[1], 10) : null,
        status:   "active",
        isMIR:    true,
        sourceUrl: `${baseUrl}/ca/orange-county/${commSlug}/${addrSlug}`,
      })
    })
    return homes
  }, { commSlug: comm.slug, baseUrl: BASE_URL })

  console.log(`  MIR homes from DOM: ${mirHomes.length}`)

  // Merge RSC with DOM plans
  const rscByName = new Map()
  for (const h of initialHits) rscByName.set(h.title, h)

  const allItems = []

  for (const domPlan of domPlans) {
    const rscHit       = rscByName.get(domPlan.planName)
    const schools      = rscHit?.schools?.map(s => `${s.type}: ${s.name}`).join(" | ") || null
    const schoolDistrict = rscHit?.school_district?.[0] || null

    allItems.push({
      type:      "plan",
      address:   domPlan.planName,
      floorPlan: domPlan.planName,
      price:     domPlan.price ?? rscHit?.display_price ?? null,
      beds:      domPlan.beds  ?? rscHit?.min_bedrooms  ?? null,
      baths:     domPlan.baths ?? rscHit?.min_bathrooms ?? null,
      sqft:      domPlan.sqft  ?? rscHit?.min_sq_feet   ?? null,
      garages:   domPlan.garages ?? rscHit?.min_garage  ?? null,
      floors:    domPlan.floors  ?? rscHit?.min_stories ?? null,
      status:    domPlan.status,
      schools,
      schoolDistrict,
      sourceUrl: domPlan.sourceUrl,
    })
  }

  for (const mir of mirHomes) {
    allItems.push({
      type:      "mir",
      address:   mir.address,
      floorPlan: null,
      price:     mir.price,
      beds:      mir.beds,
      baths:     mir.baths,
      sqft:      mir.sqft,
      garages:   mir.garages,
      floors:    null,
      status:    "active",
      schools:   null,
      sourceUrl: mir.sourceUrl,
    })
  }

  return allItems
}

// ---------------------------------------------------------------------------
// POST to ingest endpoint
// ---------------------------------------------------------------------------
async function postIngest(payload) {
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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("TRI Pointe Homes v2 Scraper (diff-based)")
  console.log("=".repeat(60))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })
  const page    = await context.newPage()

  try {
    for (const comm of KNOWN_COMMUNITIES) {
      console.log(`\n${"─".repeat(60)}`)
      console.log(`Community: ${comm.name} (${comm.city})`)

      // Scrape current listings from site
      const scraped = await scrapeCommunityPlans(page, comm)
      console.log(`  Scraped items: ${scraped.length}`)

      // Query DB for current active listings
      const db = await getDbActive(comm.name, BUILDER_NAME)
      console.log(`  DB active: ${db.byAddress.size}`)

      // Build scraped address set (for plans, address = plan name; for MIR, address = street)
      const scrapedByAddress = new Map()
      for (const item of scraped) {
        if (item.address) scrapedByAddress.set(item.address, item)
      }

      const newListings     = []
      const priceUpdates    = []
      const soldListings    = []

      // Detect new and price-changed
      for (const item of scraped) {
        if (!item.address) continue
        const dbEntry = db.byAddress.get(item.address)
        const price   = parsePriceInt(item.price)

        if (!dbEntry) {
          // New listing
          const listing = {
            address:      item.address,
            lotNumber:    null,
            currentPrice: price,
            moveInDate:   item.moveInDate || null,
            status:       item.status || "active",
            sourceUrl:    item.sourceUrl || null,
          }
          // For new homes, include full detail
          listing.floorPlan    = item.floorPlan    || null
          listing.sqft         = parseIntSafe(item.sqft)
          listing.beds         = parseFloatSafe(item.beds)
          listing.baths        = parseFloatSafe(item.baths)
          listing.garages      = parseIntSafe(item.garages)
          listing.floors       = parseIntSafe(item.floors)
          listing.pricePerSqft = price && listing.sqft ? Math.round(price / listing.sqft) : null
          newListings.push(listing)
        } else if (price && dbEntry.currentPrice !== price) {
          // Price changed
          priceUpdates.push({
            address:      item.address,
            currentPrice: price,
            status:       item.status || "active",
            sourceUrl:    item.sourceUrl || null,
          })
        }
      }

      // Detect sold (active in DB but not in scraped)
      // For MIR homes (start with digit), mark sold; for plan-level listings, skip auto-removal
      for (const [addr, dbEntry] of db.byAddress) {
        if (!scrapedByAddress.has(addr)) {
          if (/^\d/.test(addr)) {
            soldListings.push({ address: addr, status: "sold", soldAt: new Date().toISOString() })
          }
        }
      }

      console.log(`  New: ${newListings.length} | Price changes: ${priceUpdates.length} | Sold: ${soldListings.length}`)

      const hasChanges = newListings.length > 0 || priceUpdates.length > 0 || soldListings.length > 0
      if (!hasChanges) {
        console.log("  No changes — skipping ingest POST")
        continue
      }

      const allIngestListings = [
        ...newListings,
        ...priceUpdates,
        ...soldListings,
      ]

      const payload = {
        builder:   { name: BUILDER_NAME, websiteUrl: BASE_URL },
        community: { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
        listings:  allIngestListings,
      }

      console.log(`  POSTing ${allIngestListings.length} listing(s) to ingest...`)
      try {
        const result = await postIngest(payload)
        console.log(`  Ingest result:`, result)
      } catch (err) {
        console.error(`  Ingest failed:`, err.message)
      }

      await page.waitForTimeout(1000)
    }
  } finally {
    await page.close()
    await browser.close()
    await prisma.$disconnect()
  }

  console.log("\n" + "=".repeat(60))
  console.log("Done.")
  console.log("=".repeat(60))
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
