/**
 * Pulte Homes Orange County Scraper
 *
 * For each known OC community URL:
 *   1. Navigates to the community page and its /available-homes sub-page
 *   2. Tries to extract embedded JSON from script tags (window.__INITIAL_STATE__ or similar)
 *   3. Falls back to DOM scraping of home cards
 *   4. Upserts community + listing records into DB
 *
 * Also:
 *   - Marks fake intersection-address listings as removed (ids 217, 218, 219, 220, 128)
 *
 * Run: node --env-file=.env.local scripts/scrape-pulte.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Fake intersection-address listing IDs to mark removed
const FAKE_LISTING_IDS = [128, 217, 218, 219, 220]

// Known Pulte OC communities
const PULTE_COMMUNITIES = [
  {
    name: "Icon at Luna Park",
    city: "Irvine",
    state: "CA",
    url: "https://www.pulte.com/homes/california/orange-county/irvine/icon-at-luna-park-211549",
  },
  {
    name: "Parallel at Luna Park",
    city: "Irvine",
    state: "CA",
    url: "https://www.pulte.com/homes/california/orange-county/irvine/parallel-at-luna-park-211550",
  },
  {
    name: "Arden at Luna Park",
    city: "Irvine",
    state: "CA",
    url: "https://www.pulte.com/homes/california/orange-county/irvine/arden-at-luna-park-211653",
  },
  {
    name: "Eclipse at Luna Park",
    city: "Irvine",
    state: "CA",
    url: "https://www.pulte.com/homes/california/orange-county/irvine/eclipse-at-luna-park-211654",
  },
]

// Street suffix stripping
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  // Strip city/state/zip suffix (e.g. ", Irvine, CA 92618")
  addr = addr.replace(/,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}.*$/, "").trim()
  addr = addr.replace(/,\s*[A-Z]{2}\s*\d{5}.*$/, "").trim()
  // Strip trailing city (e.g. ", Irvine")
  addr = addr.replace(/,\s*[A-Za-z\s]+$/, "").trim()
  return addr
    .replace(STREET_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceInt(val) {
  if (!val) return null
  const s = String(val).replace(/[^0-9]/g, "")
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

function parseIntSafe(val) {
  if (!val) return null
  const s = String(val).replace(/[^0-9]/g, "")
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (!val) return null
  const s = String(val).replace(/[^0-9.]/g, "")
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// -----------------------------------------------------------
// Step 1: Mark fake listings as removed
// -----------------------------------------------------------
async function removeFakeListings() {
  console.log("\n[Step 1] Marking fake intersection-address listings as removed...")
  for (const id of FAKE_LISTING_IDS) {
    const listing = await prisma.listing.findUnique({ where: { id } })
    if (!listing) {
      console.log(`  Listing [${id}] not found — already removed or never existed`)
      continue
    }
    if (listing.status === "removed") {
      console.log(`  Listing [${id}] "${listing.address}" already removed`)
      continue
    }
    await prisma.listing.update({ where: { id }, data: { status: "removed" } })
    console.log(`  Marked removed [${id}]: "${listing.address}"`)
  }
}

// -----------------------------------------------------------
// Step 2: Scrape a Pulte community page for available homes
// -----------------------------------------------------------
async function scrapeAvailableHomes(context, community) {
  const page = await context.newPage()

  // Intercept API responses that look like home data
  const apiData = []
  page.on("response", async (res) => {
    try {
      const url = res.url()
      const ct = res.headers()["content-type"] || ""
      if (ct.includes("json")) {
        const text = await res.text()
        if (
          text.length > 100 &&
          (text.includes('"price"') ||
            text.includes('"Price"') ||
            text.includes('"address"') ||
            text.includes('"Address"') ||
            text.includes('"sqft"') ||
            text.includes('"Sqft"') ||
            text.includes("availableHomes") ||
            text.includes("quickMoveIn") ||
            text.includes("homeSites"))
        ) {
          try {
            apiData.push({ url: url.slice(0, 150), data: JSON.parse(text) })
          } catch {}
        }
      }
    } catch {}
  })

  try {
    // Visit the main community page first
    console.log(`  Visiting: ${community.url}`)
    await page.goto(community.url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Scroll slowly to trigger lazy loading
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(2000)

    // Try to find and click Quick Move-In or Available Homes tab/button
    const tabSelectors = [
      'a[href*="quick-move"]',
      'a[href*="available-homes"]',
      'button:has-text("Quick Move-In")',
      'button:has-text("Available Homes")',
      '[class*="tab"]:has-text("Quick Move-In")',
      '[class*="tab"]:has-text("Available Homes")',
      'a:has-text("Quick Move-In")',
      'a:has-text("Available Homes")',
    ]
    for (const sel of tabSelectors) {
      try {
        const el = page.locator(sel).first()
        if (await el.isVisible({ timeout: 1000 })) {
          await el.click()
          await page.waitForTimeout(2000)
          console.log(`  Clicked tab: ${sel}`)
          break
        }
      } catch {}
    }

    // Also visit /available-homes sub-page
    const availUrl = community.url + "/available-homes"
    console.log(`  Also visiting: ${availUrl}`)
    await page.goto(availUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Scroll again
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 400))
      await page.waitForTimeout(500)
    }
    await page.waitForTimeout(2000)

    // Try to extract embedded JSON from script tags
    const scriptResult = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"))

      // Look for window.__INITIAL_STATE__ pattern
      for (const s of scripts) {
        const text = s.textContent || ""
        if (text.includes("__INITIAL_STATE__")) {
          try {
            const m = text.match(/__INITIAL_STATE__\s*=\s*(\{.+\})\s*;?\s*$/)
            if (m) return { source: "__INITIAL_STATE__", data: JSON.parse(m[1]) }
          } catch {}
        }
      }

      // Look for embedded JSON objects with home data
      for (const s of scripts) {
        const text = s.textContent || ""
        if (
          text.includes("availableHomes") ||
          text.includes("quickMoveIn") ||
          text.includes("homeSites")
        ) {
          // Try to parse entire script as JSON
          try {
            const data = JSON.parse(text)
            return { source: "script-json", data }
          } catch {}
          // Try to extract JSON object
          try {
            const m = text.match(/=\s*(\{[\s\S]+\})\s*;/)
            if (m) {
              const data = JSON.parse(m[1])
              return { source: "script-assigned", data }
            }
          } catch {}
        }
      }

      // Check window globals
      const globalKeys = Object.keys(window).filter(
        (k) =>
          !k.startsWith("on") &&
          (k.includes("State") ||
            k.includes("state") ||
            k.includes("Data") ||
            k.includes("data") ||
            k.includes("App") ||
            k.includes("home") ||
            k.includes("Home") ||
            k.includes("listing") ||
            k.includes("Listing"))
      )

      const globals = {}
      for (const k of globalKeys.slice(0, 20)) {
        try {
          const v = window[k]
          if (v && typeof v === "object") {
            globals[k] = JSON.parse(JSON.stringify(v))
          }
        } catch {}
      }

      return { source: "globals", globals, globalKeys }
    })

    console.log(`  Script extraction result: source=${scriptResult?.source}`)
    if (scriptResult?.globalKeys) {
      console.log(`  Window globals found: ${scriptResult.globalKeys.join(", ")}`)
    }

    // Try to parse homes from the intercepted API data
    if (apiData.length > 0) {
      console.log(`  API responses intercepted: ${apiData.length}`)
      for (const api of apiData) {
        console.log(`    API: ${api.url}`)
      }

      const homes = extractHomesFromApiData(apiData)
      if (homes.length > 0) {
        console.log(`  Extracted ${homes.length} homes from API data`)
        return homes
      }
    }

    // Try to parse homes from script data
    if (scriptResult?.data) {
      const homes = extractHomesFromJson(scriptResult.data)
      if (homes.length > 0) {
        console.log(`  Extracted ${homes.length} homes from embedded script JSON`)
        return homes
      }
    }

    // Fall back to DOM scraping
    console.log("  Falling back to DOM scraping...")
    const domHomes = await scrapeHomesFromDOM(page, community)
    return domHomes
  } catch (err) {
    console.warn(`  Warning: Failed to scrape ${community.url}: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}

// -----------------------------------------------------------
// Extract homes from intercepted API JSON responses
// -----------------------------------------------------------
function extractHomesFromApiData(apiData) {
  const homes = []
  for (const api of apiData) {
    const found = extractHomesFromJson(api.data)
    for (const h of found) {
      h._apiSource = api.url
    }
    homes.push(...found)
  }
  // Deduplicate by address
  const seen = new Set()
  return homes.filter((h) => {
    const key = (h.address || "").toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// -----------------------------------------------------------
// Recursively search a JSON object for home listings
// -----------------------------------------------------------
function extractHomesFromJson(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 10) return []
  const homes = []

  // If it's an array, check if elements look like home listings
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (isHomeListing(item)) {
        const h = parseHomeFromJson(item)
        if (h) homes.push(h)
      } else {
        homes.push(...extractHomesFromJson(item, depth + 1))
      }
    }
    return homes
  }

  // Check known keys that contain home arrays
  const homeArrayKeys = [
    "availableHomes",
    "quickMoveInHomes",
    "qmi",
    "homes",
    "homeSites",
    "listings",
    "availableHomesData",
    "results",
    "items",
    "properties",
  ]

  for (const key of homeArrayKeys) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) {
      const candidates = obj[key]
      if (candidates.some(isHomeListing)) {
        for (const item of candidates) {
          if (isHomeListing(item)) {
            const h = parseHomeFromJson(item)
            if (h) homes.push(h)
          }
        }
        if (homes.length > 0) return homes
      }
    }
  }

  // Recurse into object values
  for (const [, val] of Object.entries(obj)) {
    if (val && typeof val === "object") {
      homes.push(...extractHomesFromJson(val, depth + 1))
    }
  }

  return homes
}

function isHomeListing(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
  const keys = Object.keys(obj).map((k) => k.toLowerCase())
  // Must have at least address/price/sqft or plan
  const hasAddress = keys.some((k) => k.includes("address") || k.includes("street"))
  const hasPrice = keys.some((k) => k.includes("price") || k.includes("cost"))
  const hasSpecs = keys.some(
    (k) => k.includes("sqft") || k.includes("bed") || k.includes("bath") || k.includes("plan")
  )
  return hasAddress && (hasPrice || hasSpecs)
}

function parseHomeFromJson(obj) {
  if (!obj) return null

  // Try to find address, price, beds, baths, sqft, HOA, moveIn, plan
  const get = (keys) => {
    for (const k of keys) {
      // exact match
      if (obj[k] !== undefined && obj[k] !== null) return obj[k]
      // case-insensitive
      const found = Object.entries(obj).find(
        ([key]) => key.toLowerCase() === k.toLowerCase()
      )
      if (found && found[1] !== null && found[1] !== undefined) return found[1]
    }
    return null
  }

  const address =
    get(["address", "streetAddress", "street_address", "fullAddress", "homeAddress"]) ||
    (() => {
      const num = get(["streetNumber", "houseNumber", "homeNumber"])
      const name = get(["streetName", "street"])
      if (num && name) return `${num} ${name}`
      return null
    })()

  if (!address) return null

  const price = get([
    "price",
    "listPrice",
    "basePrice",
    "totalPrice",
    "salePrice",
    "currentPrice",
    "Price",
  ])
  const sqft = get(["sqft", "squareFeet", "squareFootage", "livingArea", "area", "Sqft", "size"])
  const beds = get(["beds", "bedrooms", "bedroom", "bed", "Beds"])
  const baths = get(["baths", "bathrooms", "bathroom", "bath", "Baths", "totalBaths"])
  const garages = get(["garages", "garage", "cars", "parkingSpaces"])
  const floorPlan = get(["floorPlan", "planName", "plan", "homePlan", "modelName", "planType"])
  const hoaFees = get(["hoa", "hoaFee", "hoaFees", "hoaDues", "hoaMonthly"])
  const moveInDate = get([
    "moveInDate",
    "moveIn",
    "estimatedCloseDate",
    "readyDate",
    "availableDate",
    "closingDate",
    "deliveryDate",
  ])
  const lotNumber = get(["lotNumber", "lot", "homeSite", "homesite", "siteNumber"])
  const sourceUrl = get(["url", "detailUrl", "homeUrl", "link", "href"])
  const status = get(["status", "availabilityStatus", "homeStatus"])

  return {
    address: String(address).trim(),
    price,
    sqft,
    beds,
    baths,
    garages,
    floorPlan,
    hoaFees,
    moveInDate,
    lotNumber,
    sourceUrl,
    status,
  }
}

// -----------------------------------------------------------
// DOM scraping fallback
// -----------------------------------------------------------
async function scrapeHomesFromDOM(page, community) {
  const homes = await page.evaluate((communityUrl) => {
    const results = []

    // Pulte card selectors to try
    const cardSelectors = [
      '[class*="quick-move"]',
      '[class*="QuickMove"]',
      '[class*="home-card"]',
      '[class*="HomeCard"]',
      '[class*="listing-card"]',
      '[class*="ListingCard"]',
      '[class*="available-home"]',
      '[class*="AvailableHome"]',
      '[class*="qmi"]',
      '[class*="QMI"]',
      '[data-testid*="home"]',
      '[data-testid*="listing"]',
      'article[class*="home"]',
      'li[class*="home"]',
      '.home-listing',
      '.listing-item',
    ]

    let cards = []
    let usedSelector = ""
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel)
      if (found.length > 0) {
        cards = Array.from(found)
        usedSelector = sel
        break
      }
    }

    if (cards.length === 0) {
      // Last resort: look for any element with a price pattern near address-like text
      const allText = document.body.innerText || ""
      return {
        error: "No home cards found",
        selectors_tried: cardSelectors.length,
        body_snippet: allText.slice(0, 2000),
        usedSelector: null,
        cards_count: 0,
      }
    }

    for (const card of cards) {
      const text = card.innerText || ""
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)

      // Extract address: look for a line that starts with a number
      let address = ""
      for (const line of lines) {
        if (/^\d+\s+[A-Za-z]/.test(line)) {
          address = line
          break
        }
      }

      // Extract price: $xxx,xxx pattern
      const priceM = text.match(/\$\s*([\d,]+)/)
      const price = priceM ? priceM[1].replace(/,/g, "") : null

      // Extract beds
      const bedsM = text.match(/(\d+(?:\.\d+)?)\s*(?:beds?|bd)/i)
      const beds = bedsM ? bedsM[1] : null

      // Extract baths
      const bathsM = text.match(/(\d+(?:\.\d+)?)\s*(?:baths?|ba)/i)
      const baths = bathsM ? bathsM[1] : null

      // Extract sqft
      const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i)
      const sqft = sqftM ? sqftM[1].replace(/,/g, "") : null

      // Extract HOA
      const hoaM = text.match(/HOA[^$]*\$\s*([\d,]+)/i)
      const hoa = hoaM ? hoaM[1].replace(/,/g, "") : null

      // Extract move-in date
      const moveM = text.match(
        /(?:move[- ]in|available|est\.?\s*close|ready)[^a-zA-Z]*([A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
      )
      const moveIn = moveM ? moveM[1] : null

      // Extract plan name
      const planM = text.match(/(?:plan|model)[:\s]+([A-Za-z0-9\s-]+?)(?:\n|$)/i)
      const plan = planM ? planM[1].trim() : null

      // Extract lot/homesite
      const lotM = text.match(/(?:homesite|lot)[:\s#]*(\w+)/i)
      const lot = lotM ? lotM[1] : null

      // Link/sourceUrl
      const link = card.querySelector("a[href]")
      const href = link ? link.getAttribute("href") : null

      if (address || price) {
        results.push({
          address,
          price,
          beds,
          baths,
          sqft,
          hoaFees: hoa,
          moveInDate: moveIn,
          floorPlan: plan,
          lotNumber: lot,
          sourceUrl: href,
          _domSource: usedSelector,
        })
      }
    }

    return { homes: results, usedSelector, cards_count: cards.length }
  }, community.url)

  if (homes.error) {
    console.log(`  DOM scraping: ${homes.error}`)
    console.log(`  Body snippet:\n${homes.body_snippet?.slice(0, 500)}`)
    return []
  }

  console.log(
    `  DOM scraping found ${homes.cards_count} cards with selector "${homes.usedSelector}", extracted ${homes.homes?.length} homes`
  )
  return homes.homes || []
}

// -----------------------------------------------------------
// Step 3: Upsert community in DB
// -----------------------------------------------------------
async function upsertCommunity(builderId, comm) {
  let dbComm = await prisma.community.findFirst({
    where: { builderId, name: comm.name },
  })

  if (dbComm) {
    if (dbComm.city !== comm.city || dbComm.url !== comm.url || dbComm.state !== comm.state) {
      dbComm = await prisma.community.update({
        where: { id: dbComm.id },
        data: { city: comm.city, state: comm.state, url: comm.url },
      })
      console.log(`  Updated community [${dbComm.id}] "${comm.name}"`)
    } else {
      console.log(`  Community [${dbComm.id}] "${comm.name}" already correct`)
    }
  } else {
    dbComm = await prisma.community.create({
      data: {
        builderId,
        name: comm.name,
        city: comm.city,
        state: comm.state,
        url: comm.url,
      },
    })
    console.log(`  Created community [${dbComm.id}] "${comm.name}" in ${comm.city}`)
  }
  return dbComm
}

// -----------------------------------------------------------
// Step 4: Upsert listing in DB
// -----------------------------------------------------------
async function upsertListing(communityId, home, communityUrl) {
  const rawAddr = (home.address || "").trim()
  if (!rawAddr) return null

  // Skip listings that look like intersections (no street number)
  if (!rawAddr.match(/^\d+/)) {
    console.log(`    Skipping intersection/non-address: "${rawAddr}"`)
    return null
  }

  const address = normalizeAddress(rawAddr)
  if (!address || !address.match(/^\d+/)) {
    console.log(`    Skipping after normalize (no street number): "${rawAddr}" → "${address}"`)
    return null
  }

  const price = parsePriceInt(home.price)
  const sqft = parseIntSafe(home.sqft)
  const beds = parseFloatSafe(home.beds)
  const baths = parseFloatSafe(home.baths)
  const garages = parseIntSafe(home.garages)
  const hoaFees = parsePriceInt(home.hoaFees)
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  let sourceUrl = home.sourceUrl || null
  if (sourceUrl && sourceUrl.startsWith("/")) {
    sourceUrl = `https://www.pulte.com${sourceUrl}`
  }
  if (!sourceUrl) sourceUrl = communityUrl

  let statusVal = "active"
  if (home.status) {
    const s = String(home.status).toLowerCase()
    if (s.includes("sold") || s.includes("closed")) statusVal = "sold"
    else if (s.includes("reserv")) statusVal = "reserved"
    else if (s.includes("coming") || s.includes("future")) statusVal = "coming_soon"
  }

  // Find existing listing
  let existing = await prisma.listing.findFirst({ where: { communityId, address } })
  if (!existing) {
    const all = await prisma.listing.findMany({ where: { communityId } })
    existing =
      all.find(
        (l) => normalizeAddress(l.address).toLowerCase() === address.toLowerCase()
      ) || null
  }

  const data = {
    address,
    lotNumber: home.lotNumber ? String(home.lotNumber) : null,
    floorPlan: home.floorPlan ? String(home.floorPlan) : null,
    sqft,
    beds,
    baths,
    garages,
    currentPrice: price,
    pricePerSqft,
    hoaFees,
    moveInDate: home.moveInDate ? String(home.moveInDate) : null,
    status: statusVal,
    sourceUrl,
  }

  if (existing) {
    const oldPrice = existing.currentPrice
    await prisma.listing.update({ where: { id: existing.id }, data })
    if (price && oldPrice !== price) {
      await prisma.priceHistory.create({
        data: {
          listingId: existing.id,
          price,
          changeType: oldPrice ? (price > oldPrice ? "increase" : "decrease") : "initial",
        },
      })
      console.log(`    Updated [${existing.id}] ${address}: $${oldPrice} → $${price}`)
    } else {
      console.log(`    Refreshed [${existing.id}] ${address}: $${price}`)
    }
    return existing.id
  } else {
    const created = await prisma.listing.create({ data: { communityId, ...data } })
    if (price) {
      await prisma.priceHistory.create({
        data: { listingId: created.id, price, changeType: "initial" },
      })
    }
    console.log(
      `    Created [${created.id}] ${address} | ${home.floorPlan} | $${price} | ${beds}bd ${baths}ba ${sqft}sqft | HOA $${hoaFees} | lot ${home.lotNumber} | ${home.moveInDate}`
    )
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Pulte Homes OC Scraper")
  console.log("=".repeat(60))

  // Find Pulte builder
  let builder = await prisma.builder.findFirst({
    where: { name: { contains: "Pulte", mode: "insensitive" } },
  })

  if (!builder) {
    console.log("Pulte builder not found — creating it...")
    builder = await prisma.builder.create({
      data: {
        name: "Pulte Homes",
        websiteUrl: "https://www.pulte.com",
      },
    })
    console.log(`Created builder [${builder.id}] Pulte Homes`)
  } else {
    console.log(`\nBuilder: [${builder.id}] ${builder.name}`)
  }

  // Step 1: Mark fake listings as removed
  await removeFakeListings()

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  })

  const summary = []

  try {
    for (const comm of PULTE_COMMUNITIES) {
      console.log(`\n${"─".repeat(50)}`)
      console.log(`Community: ${comm.name} (${comm.city}, ${comm.state})`)

      // Upsert community
      console.log("\n[Upsert community]")
      const dbComm = await upsertCommunity(builder.id, comm)

      // Scrape available homes
      console.log("\n[Scrape listings]")
      const homes = await scrapeAvailableHomes(context, comm)
      console.log(`  Total homes extracted: ${homes.length}`)
      homes.forEach((h) =>
        console.log(
          `    ${h.address} | plan=${h.floorPlan} | $${h.price} | ${h.beds}bd ${h.baths}ba ${h.sqft}sqft | HOA=$${h.hoaFees} | ${h.moveInDate}`
        )
      )

      // Upsert each listing
      let created = 0,
        updated = 0,
        skipped = 0
      if (homes.length > 0) {
        console.log("\n[Upsert listings]")
        for (const home of homes) {
          const id = await upsertListing(dbComm.id, home, comm.url)
          if (id) {
            const listing = await prisma.listing.findUnique({ where: { id } })
            if (
              listing?.firstDetected &&
              Math.abs(listing.firstDetected.getTime() - listing.lastUpdated.getTime()) < 2000
            ) {
              created++
            } else {
              updated++
            }
          } else {
            skipped++
          }
        }
      }

      summary.push({
        community: comm.name,
        city: comm.city,
        communityId: dbComm.id,
        scraped: homes.length,
        created,
        updated,
        skipped,
      })

      await new Promise((r) => setTimeout(r, 1500)) // polite delay
    }
  } finally {
    await browser.close()
  }

  // Print summary
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(
    `Fake listings marked removed: ${FAKE_LISTING_IDS.join(", ")}`
  )
  console.log()

  for (const s of summary) {
    console.log(`${s.community} (${s.city}) [community id=${s.communityId}]`)
    console.log(
      `  Scraped: ${s.scraped} | Created: ${s.created} | Updated: ${s.updated} | Skipped: ${s.skipped}`
    )
  }

  const totalScraped = summary.reduce((a, b) => a + b.scraped, 0)
  console.log(`\nTotal listings scraped: ${totalScraped}`)

  // Final DB state
  console.log("\n[Final DB state — all Pulte OC listings]")
  for (const s of summary) {
    const listings = await prisma.listing.findMany({
      where: { communityId: s.communityId },
      select: {
        id: true,
        address: true,
        floorPlan: true,
        beds: true,
        baths: true,
        sqft: true,
        currentPrice: true,
        hoaFees: true,
        moveInDate: true,
        lotNumber: true,
        status: true,
      },
      orderBy: { currentPrice: "asc" },
    })
    console.log(`\n${s.community} (${s.city}) — ${listings.length} listing(s):`)
    for (const l of listings) {
      console.log(
        `  [${l.id}] ${l.address} | ${l.floorPlan} | $${l.currentPrice?.toLocaleString()} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | HOA $${l.hoaFees} | lot ${l.lotNumber} | ${l.moveInDate} | ${l.status}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
