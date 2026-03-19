/**
 * Shea Homes Orange County Scraper
 *
 * 1. Marks all active Shea listings as removed
 * 2. Scrapes each real community's available-homes page using ?qmi-tab-select#available-homes
 * 3. Extracts QMI (Quick Move-in) home cards from section.quick-move-in
 * 4. Creates real listings in DB
 *
 * Run: node --env-file=.env.local scripts/scrape-shea.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

const SHEA_BUILDER_NAME = "Shea Homes"

// Real OC communities — DB IDs confirmed by query
const SHEA_COMMUNITIES = [
  {
    dbId: 158,
    name: "Arbor at Portola Springs Village",
    city: "Irvine",
    state: "CA",
    url: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/arbor-at-portola-springs-village",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/arbor-at-portola-springs-village?qmi-tab-select#available-homes",
  },
  {
    dbId: 159,
    name: "Arrowleaf",
    city: "Rancho Mission Viejo",
    state: "CA",
    url: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/arrowleaf",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/arrowleaf?qmi-tab-select#available-homes",
  },
  {
    dbId: 160,
    name: "Bloom at Rienda",
    city: "Rancho Mission Viejo",
    state: "CA",
    url: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/bloom-at-rienda",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/rancho-mission-viejo/bloom-at-rienda?qmi-tab-select#available-homes",
  },
  {
    dbId: 161,
    name: "Cielo at Portola Springs Village",
    city: "Irvine",
    state: "CA",
    url: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/cielo-at-portola-springs-village",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/cielo-at-portola-springs-village?qmi-tab-select#available-homes",
  },
  {
    dbId: 162,
    name: "Crestview",
    city: "Irvine",
    state: "CA",
    url: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/crestview",
    availableHomesUrl: "https://www.sheahomes.com/new-homes/california/orange-county/irvine/crestview?qmi-tab-select#available-homes",
  },
]

// Street suffix stripping
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr.replace(STREET_SUFFIXES, "").replace(/\s+/g, " ").trim()
}

function parsePriceFromText(text) {
  // Handles "Priced From $2,049,984" — dollar sign is code 36 (confirmed)
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

// -----------------------------------------------------------
// Parse a home card from its flattened innerText
// The text looks like (newlines separating fields):
//   Save to Favorites
//   Home Tour
//   4 Photos
//   Homesite 0030
//   222 Maricopa
//   Plan 3
//   Priced From $2,049,984
//
//   2,420
//   Sq. Ft.
//   2
//   Story
//   2
//   Car Garage
//   3
//   Bedrooms
//   2
//   Bathrooms
//   VIEW HOME DETAILS
// -----------------------------------------------------------
function parseHomeCard(rawText, sourceUrl) {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)

  let homesite = null
  let address = null
  let plan = null
  let price = null
  let sqft = null
  let beds = null
  let baths = null
  let floors = null
  let isSold = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineLower = line.toLowerCase()

    // Skip UI chrome
    if (/^(save to favorites|home tour|view home details|recently sold|home is sold|move-in now|car garage|\d+ photos?)$/i.test(line)) {
      if (/recently sold|home is sold/i.test(line)) isSold = true
      continue
    }

    // Homesite
    if (/^Homesite\s+\d+/i.test(line)) {
      homesite = line.match(/\d+/)[0]
      continue
    }

    // Plan
    if (/^Plan\s+\w+$/i.test(line)) {
      plan = line
      continue
    }

    // Price line
    if (/Priced From/i.test(line)) {
      price = parsePriceFromText(line)
      continue
    }

    // Sqft — a number followed by "Sq. Ft." on next line
    if (/^Sq\.?\s*Ft\.?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d,]+$/.test(prev)) {
        sqft = parseIntFromText(prev)
      }
      continue
    }

    // Story (floors)
    if (/^Story$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^\d+$/.test(prev)) floors = parseInt(prev, 10)
      continue
    }

    // Bedrooms
    if (/^Bedrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) beds = parseFloatFromText(prev)
      continue
    }

    // Bathrooms
    if (/^Bathrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) baths = parseFloatFromText(prev)
      continue
    }

    // Address: a line with a street number + name (comes after homesite, before Plan)
    // Must contain a digit at start, be reasonably short, not be a price or sqft
    if (!address && homesite && !plan) {
      if (/^\d+\s+[A-Za-z]/.test(line) && line.length < 60 && !line.includes("$")) {
        address = line
      }
    }
  }

  if (isSold) return null
  if (!homesite && !address) return null

  return {
    homesite,
    address: address || null,
    plan,
    price,
    sqft,
    beds,
    baths,
    floors,
    sourceUrl,
    isSold,
  }
}

// -----------------------------------------------------------
// Scrape a single community's available homes page
// -----------------------------------------------------------
async function scrapeAvailableHomesPage(context, community) {
  console.log(`\n  Scraping: ${community.name}`)
  console.log(`  URL: ${community.availableHomesUrl}`)

  const page = await context.newPage()
  const listings = []

  try {
    await page.goto(community.availableHomesUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    // Scroll to load lazy content and trigger JS rendering
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(2000)

    // Get QMI count for logging
    const qmiInfo = await page.evaluate(() => {
      const text = document.body?.innerText || ""
      const qmiM = text.match(/Quick Move-ins?\s*\((\d+)\)/i)
      const planM = text.match(/Home Plans?\s*\((\d+)\)/i)
      return {
        qmiCount: qmiM ? parseInt(qmiM[1]) : null,
        planCount: planM ? parseInt(planM[1]) : null,
        hasQmiSection: !!document.querySelector("section.quick-move-in"),
      }
    })

    console.log(`    QMI count: ${qmiInfo.qmiCount ?? "unknown"} | Plans: ${qmiInfo.planCount ?? "unknown"} | QMI section: ${qmiInfo.hasQmiSection}`)

    if (!qmiInfo.hasQmiSection) {
      console.log(`    No QMI section found — community may have no available homes`)
      return listings
    }

    // Extract QMI home cards
    const rawCards = await page.evaluate(() => {
      const qmiSection = document.querySelector("section.quick-move-in")
      if (!qmiSection) return []

      // All homesite-specific links (not plan links)
      const titleLinks = Array.from(qmiSection.querySelectorAll("a.home-card_content-title"))
      const homesiteLinks = titleLinks.filter(a => a.href && a.href.includes("homesite"))

      return homesiteLinks.map(a => {
        // Walk up to find the container that has Sq. Ft. data
        let el = a
        for (let i = 0; i < 10; i++) {
          el = el.parentElement
          if (!el) break
          const text = el.innerText || ""
          if (text.includes("Sq. Ft.") || text.includes("Bedrooms")) break
        }
        return {
          href: a.href,
          rawText: el ? el.innerText : a.innerText,
        }
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

// -----------------------------------------------------------
// Upsert a listing in the DB
// -----------------------------------------------------------
async function upsertListing(communityId, communityName, listingData) {
  let rawAddress = listingData.address
  const lotNumber = listingData.homesite ? String(listingData.homesite).padStart(4, "0") : null

  // Build address from homesite if no street address
  if (!rawAddress) {
    if (lotNumber) {
      rawAddress = `Homesite ${lotNumber}`
    } else {
      console.log(`    Skipping listing with no address or homesite`)
      return null
    }
  }

  // Strip street suffix per project rules
  const address = normalizeAddress(rawAddress.trim())
  if (!address || address.length < 3) return null

  // Guard against garbage
  if (/^(schedule|save|plan available|quick move|sold|favorite|n\/a|tbd)/i.test(address)) {
    console.log(`    Skipping garbage address: "${address}"`)
    return null
  }

  const price = listingData.price || null
  const sqft = listingData.sqft || null
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  // Try exact match first, then case-insensitive
  let existing = await prisma.listing.findFirst({ where: { communityId, address } })
  if (!existing) {
    const allListings = await prisma.listing.findMany({ where: { communityId } })
    existing = allListings.find(
      l => normalizeAddress(l.address).toLowerCase() === address.toLowerCase()
    )
  }

  const data = {
    address,
    lotNumber,
    floorPlan: listingData.plan || null,
    sqft,
    beds: listingData.beds || null,
    baths: listingData.baths || null,
    floors: listingData.floors || null,
    currentPrice: price,
    pricePerSqft,
    status: "active",
    sourceUrl: listingData.sourceUrl || null,
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
    }
    console.log(`    Updated listing [${existing.id}] "${address}": $${price?.toLocaleString() ?? "N/A"}`)
    return existing.id
  } else {
    const created = await prisma.listing.create({ data: { communityId, ...data } })
    if (price) {
      await prisma.priceHistory.create({
        data: { listingId: created.id, price, changeType: "initial" },
      })
    }
    console.log(`    Created listing [${created.id}] "${address}": $${price?.toLocaleString() ?? "N/A"}`)
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Shea Homes Orange County Scraper")
  console.log("=".repeat(60))

  // Confirm builder
  const builder = await prisma.builder.findFirst({ where: { name: SHEA_BUILDER_NAME } })
  if (!builder) {
    console.error(`Builder "${SHEA_BUILDER_NAME}" not found in DB`)
    process.exit(1)
  }
  console.log(`\nBuilder: [${builder.id}] ${builder.name}`)

  // ---------- Step 1: Mark ALL active Shea listings as removed ----------
  console.log("\n[Step 1] Marking all active Shea listings as removed...")

  const allSheaCommunities = await prisma.community.findMany({
    where: { builderId: builder.id },
    include: { listings: { where: { status: "active" } } },
  })

  let removedCount = 0
  for (const comm of allSheaCommunities) {
    for (const listing of comm.listings) {
      await prisma.listing.update({ where: { id: listing.id }, data: { status: "removed" } })
      console.log(`  Removed listing [${listing.id}] in "${comm.name}": "${listing.address}"`)
      removedCount++
    }
  }
  console.log(`  Total removed: ${removedCount}`)

  // ---------- Step 2: Update community URL/city records ----------
  console.log("\n[Step 2] Updating real community records...")
  for (const commDef of SHEA_COMMUNITIES) {
    const dbComm = await prisma.community.findUnique({ where: { id: commDef.dbId } })
    if (!dbComm) {
      console.log(`  Community [${commDef.dbId}] not found — skipping`)
      continue
    }
    await prisma.community.update({
      where: { id: commDef.dbId },
      data: { city: commDef.city, state: commDef.state, url: commDef.url },
    })
    console.log(`  Updated [${commDef.dbId}] "${commDef.name}" → city=${commDef.city}`)
  }

  // ---------- Step 3: Scrape available homes pages ----------
  console.log("\n[Step 3] Scraping available-homes pages with Playwright...")

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  })

  const allScraped = []
  try {
    for (const commDef of SHEA_COMMUNITIES) {
      const listings = await scrapeAvailableHomesPage(context, commDef)
      allScraped.push({ commDef, listings })
      await new Promise(r => setTimeout(r, 2000))
    }
  } finally {
    await browser.close()
  }

  // ---------- Step 4: Upsert listings ----------
  console.log("\n[Step 4] Upserting scraped listings into DB...")
  let totalUpserted = 0

  for (const { commDef, listings } of allScraped) {
    console.log(`\n  Community [${commDef.dbId}] ${commDef.name} — ${listings.length} available home(s) scraped`)
    if (listings.length === 0) {
      console.log(`    No available homes found (sold out or not listed online)`)
      continue
    }
    for (const listing of listings) {
      const id = await upsertListing(commDef.dbId, commDef.name, listing)
      if (id) totalUpserted++
    }
  }

  // ---------- Summary ----------
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Listings marked removed (garbage): ${removedCount}`)
  console.log(`Listings upserted (real scraped):  ${totalUpserted}`)

  console.log("\nFinal DB state — all Shea Homes communities:")
  const finalState = await prisma.community.findMany({
    where: { builderId: builder.id },
    include: {
      listings: {
        where: { status: "active" },
        select: {
          id: true, address: true, currentPrice: true,
          beds: true, baths: true, sqft: true,
          lotNumber: true, floorPlan: true, floors: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  })

  for (const c of finalState) {
    console.log(`\n  [${c.id}] ${c.name} (${c.city}) — ${c.listings.length} active listing(s)`)
    for (const l of c.listings) {
      const price = l.currentPrice ? `$${l.currentPrice.toLocaleString()}` : "N/A"
      const details = `${l.beds ?? "?"}bd ${l.baths ?? "?"}ba ${l.sqft?.toLocaleString() ?? "?"}sqft`
      console.log(`    [${l.id}] "${l.address}" | ${price} | ${details} | lot=${l.lotNumber ?? "N/A"} plan=${l.floorPlan ?? "N/A"}`)
    }
    if (c.listings.length === 0) console.log(`    (none active)`)
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
