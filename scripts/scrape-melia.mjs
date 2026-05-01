/**
 * Melia Homes Orange County Scraper — diff-based
 *
 * 1. For each community, scrape the availability section for current homes.
 * 2. Query DB for current active listings.
 * 3. Diff: new → ingest, sold → mark sold, price changed → update price.
 * 4. Only POST to ingest if changes exist.
 * 5. Full detail only sent for new listings.
 *
 * Run: node scripts/scrape-melia.mjs
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
const BUILDER_NAME  = "Melia Homes"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const MELIA_COMMUNITIES = [
  {
    name:  "Cerise",
    city:  "Cypress",
    state: "CA",
    url:   "https://meliahomes.com/new-homes/ca/cypress/cerise-at-citrus-square/",
  },
  {
    name:  "Towns at Orange",
    city:  "Anaheim",
    state: "CA",
    url:   "https://meliahomes.com/new-homes/ca/anaheim/townes-at-orange/",
  },
  {
    name:  "Indigo",
    city:  "Hawthorne",
    state: "CA",
    url:   "https://meliahomes.com/new-homes/ca/hawthorne/indigo/",
  },
  {
    name:  "Elara",
    city:  "Whittier",
    state: "CA",
    url:   "https://meliahomes.com/new-homes/ca/whittier/elara/",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toTitleCase(str) {
  if (!str) return ""
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
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
// Parse listing blocks from the availability section innerText
// ---------------------------------------------------------------------------
function parseAvailabilityText(rawText, detailLinks, communityUrl) {
  if (!rawText || !rawText.trim()) return []

  const lines   = rawText.split(/\r?\n/).map(l => l.trim())
  const results = []
  const seen    = new Set()
  let linkIdx   = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^\$[\d,]+$/.test(line)) continue

    const price = parseInt(line.replace(/[^0-9]/g, ""), 10)
    if (!price || price < 100000) continue

    let beds = null, baths = null, sqft = null, floorPlan = null, address = null

    for (let j = i - 1; j >= Math.max(0, i - 25); j--) {
      const l = lines[j]
      if (!l) continue

      if (/^\d[\d,]*\s+Square\s+Feet$/i.test(l) && sqft === null) {
        sqft = parseInt(l.replace(/[^0-9]/g, ""), 10)
        continue
      }
      if (/^\d[\d.]*\s+Bathrooms?$/i.test(l) && baths === null) {
        baths = parseFloat(l)
        continue
      }
      if (/^\d[\d.]*\s+Bedrooms?$/i.test(l) && beds === null) {
        beds = parseFloat(l)
        continue
      }
      if (/^(Condominium|Townhome|3 Story Townhome|Single[- ]Family|Condo)$/i.test(l) && floorPlan === null) {
        floorPlan = l
        continue
      }
      if (/^\d+\s+\w/.test(l) && !l.match(/,\s*CA\s+\d{5}/) && !l.match(/Bedrooms|Bathrooms|Square|\$/)) {
        address = toTitleCase(l)
        break
      }
    }

    if (!address) continue
    if (seen.has(address)) continue
    seen.add(address)

    const sourceUrl = detailLinks[linkIdx] || communityUrl
    linkIdx++

    results.push({ address, price, beds, baths, sqft, floorPlan, sourceUrl })
  }

  // Deduplicate
  const final    = []
  const finalSeen = new Set()
  for (const r of results) {
    if (!finalSeen.has(r.address)) {
      finalSeen.add(r.address)
      final.push(r)
    }
  }
  return final
}

// ---------------------------------------------------------------------------
// Scrape a Melia community page for available homes
// ---------------------------------------------------------------------------
async function scrapeCommunityPage(context, community) {
  console.log(`\n  Scraping: ${community.url}`)
  const page = await context.newPage()

  try {
    await page.goto(community.url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(2000)

    const { sectionText, detailLinks } = await page.evaluate(() => {
      let availSection = document.getElementById("availability")

      if (!availSection || !(availSection.innerText || "").match(/\$[\d,]+/)) {
        const allSections = Array.from(document.querySelectorAll("section, [role='region']"))
        const fallback = allSections.find(s => {
          const txt = s.innerText || ""
          return /\$[\d,]+/.test(txt) && /Bedrooms/.test(txt) && /Square Feet/.test(txt)
        })
        if (fallback) availSection = fallback
      }

      const sectionText = availSection ? (availSection.innerText || "") : ""

      const detailLinks = Array.from(document.querySelectorAll("a"))
        .filter(a => a.textContent.trim() === "Details")
        .map(a => {
          const href = a.getAttribute("href") || ""
          return href.startsWith("http") ? href : "https://meliahomes.com" + href
        })

      return { sectionText, detailLinks }
    })

    const homes = parseAvailabilityText(sectionText, detailLinks, community.url)
    console.log(`    Extracted ${homes.length} unique listing(s)`)

    if (homes.length === 0) {
      const snippet = sectionText.slice(0, 500)
      console.log(`    Debug — availability section text (first 500 chars):\n${snippet}`)
    }

    return homes
  } catch (err) {
    console.warn(`    Warning: Failed to scrape ${community.url}: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------------------
// Normalize address — strip street suffix but preserve unit
// ---------------------------------------------------------------------------
function normalizeListingAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(/,?\s+(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?(?=\s+(Unit|Apt|#|$))/i, "")
    .replace(/\s+/g, " ")
    .trim()
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Melia Homes OC Scraper (diff-based)")
  console.log("=".repeat(60))

  const meliaBuilder = await prisma.builder.findFirst({
    where: { name: { contains: "Melia", mode: "insensitive" } },
  })
  if (!meliaBuilder) {
    console.error("Error: Could not find Melia Homes builder in DB")
    const all = await prisma.builder.findMany({ select: { id: true, name: true } })
    console.log("Available builders:")
    all.forEach(b => console.log(`  [${b.id}] ${b.name}`))
    process.exit(1)
  }
  console.log(`\nBuilder: [${meliaBuilder.id}] ${meliaBuilder.name}`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const browserContext = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  try {
    for (const comm of MELIA_COMMUNITIES) {
      console.log(`\n${"─".repeat(56)}`)
      console.log(`Community: ${comm.name} (${comm.city}, ${comm.state})`)

      // Scrape current listings from site
      const homes = await scrapeCommunityPage(browserContext, comm)
      console.log(`  Scraped: ${homes.length}`)

      // Query DB for current active listings
      const db = await getDbActive(comm.name, BUILDER_NAME)
      console.log(`  DB active: ${db.byAddress.size}`)

      // Normalize scraped addresses
      const scrapedByAddress = new Map()
      for (const home of homes) {
        const address = normalizeListingAddress(home.address || "")
        if (!address) continue
        scrapedByAddress.set(address, { ...home, address })
      }

      const newListings  = []
      const priceUpdates = []
      const soldListings = []

      // Detect new and price-changed
      for (const [address, item] of scrapedByAddress) {
        const price   = item.price || null
        const dbEntry = db.byAddress.get(address)
          || [...db.byAddress.entries()].find(([a]) => a.toLowerCase() === address.toLowerCase())?.[1]

        if (!dbEntry) {
          // New listing — full detail
          newListings.push({
            address,
            currentPrice: price,
            status:       "active",
            sourceUrl:    item.sourceUrl || null,
            floorPlan:    item.floorPlan || null,
            sqft:         item.sqft || null,
            beds:         item.beds != null ? item.beds : null,
            baths:        item.baths != null ? item.baths : null,
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

      // Detect sold (active in DB but not in scraped)
      for (const [addr] of db.byAddress) {
        const found = scrapedByAddress.has(addr)
          || [...scrapedByAddress.keys()].some(a => a.toLowerCase() === addr.toLowerCase())
        if (!found) {
          soldListings.push({ address: addr, status: "sold", soldAt: new Date().toISOString() })
        }
      }

      console.log(`  New: ${newListings.length} | Price changes: ${priceUpdates.length} | Sold: ${soldListings.length}`)

      const hasChanges = newListings.length > 0 || priceUpdates.length > 0 || soldListings.length > 0
      if (!hasChanges) {
        console.log("  No changes — skipping ingest POST")
        await new Promise(r => setTimeout(r, 1000))
        continue
      }

      const payload = {
        builder:   { name: BUILDER_NAME, websiteUrl: "https://meliahomes.com" },
        community: { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
        listings:  [...newListings, ...priceUpdates, ...soldListings],
      }

      console.log(`  POSTing ${payload.listings.length} listing(s) to ingest...`)
      try {
        const result = await postIngest(payload)
        console.log("  Ingest result:", result)
      } catch (err) {
        console.error("  Ingest failed:", err.message)
      }

      await new Promise(r => setTimeout(r, 1000))
    }
  } finally {
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
