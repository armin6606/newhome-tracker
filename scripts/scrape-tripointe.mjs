/**
 * TRI Pointe Homes Orange County Scraper
 *
 * Site structure (verified 2026-03-19):
 *   OC search: https://www.tripointehomes.com/find-your-home/ca/orange-county
 *   3 communities: Lavender at RMV, Heatherly at RMV, Naya at Luna Park (Irvine)
 *   Listings = floor plans (ready-to-build) + move-in-ready addressed homes
 *   One move-in ready: 31680 Williams Way, Heatherly, $1,275,000
 *
 * Actions:
 *   1. Mark listings 110, 210 as removed (garbage)
 *   2. Fix listing 211 (31680 Williams) → Heatherly community
 *   3. Clean up previous bad data (garbled listing 343, duplicate 351, bad city names)
 *   4. Discover/scrape all 3 OC communities
 *   5. Upsert communities with correct city names
 *   6. Scrape floor plans + MIR homes → upsert as listings
 *
 * Run: node --env-file=.env.local scripts/scrape-tripointe.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const BASE_URL = "https://www.tripointehomes.com"
const OC_COMMUNITIES_URL = `${BASE_URL}/find-your-home/ca/orange-county?type=communities`
const OC_MIR_URL = `${BASE_URL}/find-your-home/ca/orange-county?type=move-in-ready`

// Garbage listing IDs to mark as removed
const GARBAGE_IDS = [110, 210]

// Listing 211: 31680 Williams Way belongs to Heatherly at Rancho Mission Viejo
const LISTING_211_ID = 211
const HEATHERLY_COMMUNITY_NAME = "Heatherly at Rancho Mission Viejo"
const HEATHERLY_CITY = "Rancho Mission Viejo"
const HEATHERLY_URL = `${BASE_URL}/ca/orange-county/heatherly-at-rancho-mission-viejo`

// Known OC communities with correct data (used as authoritative source)
const KNOWN_COMMUNITIES = [
  {
    name: "Lavender at Rancho Mission Viejo",
    slug: "lavender-at-rancho-mission-viejo",
    city: "Rancho Mission Viejo",
    state: "CA",
    url: `${BASE_URL}/ca/orange-county/lavender-at-rancho-mission-viejo`,
    comingSoon: false,
  },
  {
    name: HEATHERLY_COMMUNITY_NAME,
    slug: "heatherly-at-rancho-mission-viejo",
    city: HEATHERLY_CITY,
    state: "CA",
    url: HEATHERLY_URL,
    comingSoon: false,
  },
  {
    name: "Naya at Luna Park",
    slug: "naya-at-luna-park",
    city: "Irvine",
    state: "CA",
    url: `${BASE_URL}/ca/orange-county/naya-at-luna-park`,
    comingSoon: true,
  },
]

// Street suffix regex for address normalization
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr.replace(STREET_SUFFIXES, "").replace(/\s+/g, " ").trim()
}

function parsePriceInt(val) {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (val == null) return null
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function parseIntSafe(val) {
  if (val == null) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

// -----------------------------------------------------------
// Step 1: Mark garbage listings as removed
// -----------------------------------------------------------
async function markGarbageListings() {
  console.log("\n[Step 1] Marking garbage listings as removed...")
  for (const id of GARBAGE_IDS) {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { community: { select: { name: true } } },
    })
    if (!listing) {
      console.log(`  Listing [${id}] not found — skipping`)
      continue
    }
    if (listing.status === "removed") {
      console.log(`  Listing [${id}] "${listing.address}" already removed`)
      continue
    }
    await prisma.listing.update({ where: { id }, data: { status: "removed" } })
    console.log(`  Marked [${id}] "${listing.address}" (community: "${listing.community.name}") as removed`)
  }
}

// -----------------------------------------------------------
// Step 2: Fix listing 211 → Heatherly community
// -----------------------------------------------------------
async function fixListing211(builderId) {
  console.log("\n[Step 2] Fixing listing 211 → Heatherly community...")

  const listing = await prisma.listing.findUnique({
    where: { id: LISTING_211_ID },
    include: { community: true },
  })

  if (!listing) {
    console.log(`  Listing [${LISTING_211_ID}] not found — skipping`)
    return null
  }

  console.log(
    `  Found [${LISTING_211_ID}]: address="${listing.address}" | community="${listing.community.name}"`
  )

  // Get or create Heatherly community
  let heatherlyCom = await prisma.community.findFirst({
    where: { builderId, name: HEATHERLY_COMMUNITY_NAME },
  })

  if (!heatherlyCom) {
    heatherlyCom = await prisma.community.create({
      data: {
        builderId,
        name: HEATHERLY_COMMUNITY_NAME,
        city: HEATHERLY_CITY,
        state: "CA",
        url: HEATHERLY_URL,
      },
    })
    console.log(`  Created community [${heatherlyCom.id}] "${HEATHERLY_COMMUNITY_NAME}"`)
  } else {
    console.log(`  Community [${heatherlyCom.id}] "${HEATHERLY_COMMUNITY_NAME}" exists`)
  }

  // Move listing 211 to correct community if needed
  if (listing.communityId !== heatherlyCom.id) {
    const normAddr = normalizeAddress(listing.address)
    const conflict = await prisma.listing.findFirst({
      where: { communityId: heatherlyCom.id, address: normAddr },
    })
    if (conflict && conflict.id !== LISTING_211_ID) {
      console.log(
        `  Address "${normAddr}" already in Heatherly [listing ${conflict.id}] — marking 211 removed`
      )
      await prisma.listing.update({ where: { id: LISTING_211_ID }, data: { status: "removed" } })
    } else {
      await prisma.listing.update({
        where: { id: LISTING_211_ID },
        data: { communityId: heatherlyCom.id },
      })
      console.log(
        `  Moved [${LISTING_211_ID}] "${listing.address}" → community [${heatherlyCom.id}] "${HEATHERLY_COMMUNITY_NAME}"`
      )
    }
  } else {
    console.log(`  Listing [${LISTING_211_ID}] already in correct community`)
  }

  return heatherlyCom
}

// -----------------------------------------------------------
// Step 3: Clean up bad data from previous runs
// -----------------------------------------------------------
async function cleanupBadData(builderId) {
  console.log("\n[Step 3] Cleaning up bad data from previous runs...")

  // Fix community city names that got garbled (contain "Now Selling" or "Coming Soon")
  const allComms = await prisma.community.findMany({ where: { builderId } })
  for (const comm of allComms) {
    const known = KNOWN_COMMUNITIES.find((k) => k.name === comm.name)
    if (!known) continue
    const updates = {}
    if (comm.city !== known.city) updates.city = known.city
    if (comm.url !== known.url) updates.url = known.url
    if (Object.keys(updates).length > 0) {
      await prisma.community.update({ where: { id: comm.id }, data: updates })
      console.log(
        `  Fixed community [${comm.id}] "${comm.name}": city="${comm.city}" → "${known.city}"`
      )
    }
  }

  // Helper to safely delete a listing and its price history
  async function safeDeleteListing(id, reason) {
    const l = await prisma.listing.findUnique({ where: { id } })
    if (!l) return
    await prisma.priceHistory.deleteMany({ where: { listingId: id } })
    await prisma.listing.delete({ where: { id } })
    console.log(`  Deleted listing [${id}] "${l.address}" (${reason})`)
  }

  // Remove garbage listings created with bad plan names (city bled into address/plan name)
  const badPatterns = [
    "Plan 1Rancho", "Plan 2Rancho", "Plan 3Rancho", "Plan 3XRancho",
    "Plan 2Irvine", "Plan 1Irvine", "Plan 3Irvine", "Plan 4Irvine", "Plan 5Irvine",
  ]
  for (const pattern of badPatterns) {
    const bad = await prisma.listing.findMany({ where: { address: pattern } })
    for (const l of bad) {
      await prisma.priceHistory.deleteMany({ where: { listingId: l.id } })
      await prisma.listing.delete({ where: { id: l.id } })
      console.log(`  Deleted garbled listing [${l.id}] "${l.address}"`)
    }
  }

  // Remove listing 343 (address = community name, created by accident)
  await safeDeleteListing(343, "address was community name")

  // Remove duplicate 31680 Williams listings in the wrong "Ready" community (ids 351, 362, etc.)
  const readyComm = await prisma.community.findFirst({ where: { builderId, name: "Ready" } })
  if (readyComm) {
    const dupes = await prisma.listing.findMany({ where: { communityId: readyComm.id } })
    for (const l of dupes) {
      await safeDeleteListing(l.id, `duplicate in wrong community "Ready" [comm id=${readyComm.id}]`)
    }
  }

  console.log("  Cleanup done")
}

// -----------------------------------------------------------
// Step 4: Scrape community page for floor plans + MIR homes
// Each community page has:
//   - A "Move-In Ready Homes" section (addressed homes with $ price)
//   - A "Ready-to-Build Floorplans" section (named plans with $ from price)
// We scrape both.
// -----------------------------------------------------------
async function scrapeCommunityPage(page, community) {
  console.log(`\n  Scraping: ${community.url}`)

  await page.goto(community.url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(4000)

  // Scroll to load all lazy content
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 700))
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(2000)

  // Check for "Load More" button and click it
  const loadMoreClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim().toLowerCase().includes("load more")
    )
    if (btn) { btn.click(); return true }
    return false
  })
  if (loadMoreClicked) {
    await page.waitForTimeout(2000)
    console.log("    Clicked 'Load More'")
  }

  const results = await page.evaluate(({ baseUrl, commSlug }) => {
    const listings = []
    const seen = new Set()

    // Find all links that go to sub-pages of this community
    const commPathPrefix = `/ca/orange-county/${commSlug}/`

    document.querySelectorAll("a[href]").forEach((el) => {
      const href = el.getAttribute("href") || ""
      if (!href.startsWith(commPathPrefix)) return

      const subSlug = href.slice(commPathPrefix.length).replace(/\/$/, "")
      if (!subSlug || seen.has(subSlug)) return
      seen.add(subSlug)

      // Is this a move-in-ready home? Address slugs start with digits.
      const isMIR = /^\d/.test(subSlug)

      // Is this a floor plan? Plan slugs typically contain "plan"
      const isPlan = subSlug.toLowerCase().includes("plan")

      if (!isMIR && !isPlan) return // skip unknown sub-pages

      // Parse card text — walk up to find the card container
      const card = el.closest("article, li, [class*='card'], [class*='Card'], [class*='item'], [class*='result']") || el.parentElement || el
      const text = card?.textContent?.trim() || el.textContent?.trim() || ""

      // ── Plan name ────────────────────────────────────────────
      // For plans, extract from sub-slug: "plan-1-215265" → "Plan 1", "naya-at-luna-park-plan-5" → "Plan 5"
      let planName = null
      const planSlugMatch = subSlug.match(/plan[- _](\w+)/i)
      if (planSlugMatch) {
        planName = `Plan ${planSlugMatch[1].toUpperCase()}`
      }

      // ── Address ──────────────────────────────────────────────
      // For MIR homes, build address from slug and strip suffix
      let address = null
      if (isMIR) {
        const parts = subSlug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        const raw = parts.join(" ")
        address = raw.replace(
          /\s+(Way|Street|St|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)$/i,
          ""
        )
      }

      // ── Price ────────────────────────────────────────────────
      // Look for first $ amount in the card text
      const priceM = text.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null

      // ── Beds ─────────────────────────────────────────────────
      // Handles "2-3 BEDS" or "4 BEDS"
      const bedsM = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const beds = bedsM ? parseFloat(bedsM[1]) : null  // use min beds

      // ── Baths ────────────────────────────────────────────────
      const bathsM = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const baths = bathsM ? parseFloat(bathsM[1]) : null

      // ── Sqft ─────────────────────────────────────────────────
      // Handle ranges like "1,296-2,202 SQ. FT."
      const sqftM = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      let sqft = null
      if (sqftM) {
        // use max sqft for ranges
        const sqftVal = sqftM[2] || sqftM[1]
        sqft = parseInt(sqftVal.replace(/,/g, ""), 10)
      }

      // ── Garages ──────────────────────────────────────────────
      const garM = text.match(/([\d]+)\s*BAY\s*GARAGE/i)
      const garages = garM ? parseInt(garM[1], 10) : null

      // ── Status ───────────────────────────────────────────────
      let status = "active"
      if (/coming\s*soon/i.test(text)) status = "coming-soon"

      listings.push({
        subSlug,
        isMIR,
        address: address || null,
        floorPlan: planName || null,
        price,
        beds,
        baths,
        sqft,
        garages,
        status,
        sourceUrl: `${baseUrl}/ca/orange-county/${commSlug}/${subSlug}`,
      })
    })

    return listings
  }, { baseUrl: BASE_URL, commSlug: community.slug })

  console.log(`    Found ${results.length} listing(s):`)
  results.forEach((l) => {
    const label = l.isMIR ? `[MIR] ${l.address}` : `[Plan] ${l.floorPlan}`
    console.log(`      ${label} | $${l.price?.toLocaleString() ?? "N/A"} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | ${l.status}`)
  })

  return results
}

// -----------------------------------------------------------
// Step 5: Scrape MIR tab to catch any MIR homes not on comm pages
// -----------------------------------------------------------
async function scrapeMIRTab(page, builderId) {
  console.log("\n[Step 5] Scraping move-in-ready tab...")

  await page.goto(OC_MIR_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(4000)
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 600))
    await page.waitForTimeout(350)
  }
  await page.waitForTimeout(1500)

  const mirListings = await page.evaluate((baseUrl) => {
    const results = []
    const seen = new Set()

    document.querySelectorAll('a[href*="/ca/orange-county/"]').forEach((el) => {
      const href = el.getAttribute("href") || ""
      // MIR home listing: /ca/orange-county/{comm-slug}/{address-slug-starting-with-digit}
      const m = href.match(/^\/ca\/orange-county\/([^/]+)\/(\d[^/?#]*)/)
      if (!m) return
      if (seen.has(href)) return
      seen.add(href)

      const commSlug = m[1]
      const addrSlug = m[2]

      const card = el.closest("article, li, [class*='card'], [class*='item']") || el.parentElement || el
      const text = card?.textContent?.trim() || el.textContent?.trim() || ""

      // Address from slug, suffix stripped
      let address = addrSlug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      address = address.replace(
        /\s+(Way|Street|St|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)$/i,
        ""
      )

      const priceM = text.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null

      const bedsM = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const beds = bedsM ? parseFloat(bedsM[1]) : null

      const bathsM = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const baths = bathsM ? parseFloat(bathsM[1]) : null

      const sqftM = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      const sqft = sqftM ? parseInt((sqftM[2] || sqftM[1]).replace(/,/g, ""), 10) : null

      const garM = text.match(/([\d]+)\s*BAY\s*GARAGE/i)
      const garages = garM ? parseInt(garM[1], 10) : null

      results.push({
        commSlug,
        address,
        price,
        beds,
        baths,
        sqft,
        garages,
        status: "active",
        sourceUrl: `${baseUrl}${href}`,
      })
    })

    return results
  }, BASE_URL)

  console.log(`  Found ${mirListings.length} MIR home(s):`)
  for (const m of mirListings) {
    console.log(`    [${m.commSlug}] ${m.address} | $${m.price?.toLocaleString() ?? "N/A"} | ${m.beds}bd ${m.baths}ba ${m.sqft}sqft`)
  }

  return mirListings
}

// -----------------------------------------------------------
// Upsert community with authoritative city name
// -----------------------------------------------------------
async function upsertCommunity(builderId, known) {
  let dbComm = await prisma.community.findFirst({
    where: { builderId, name: known.name },
  })

  if (dbComm) {
    const updates = {}
    if (dbComm.city !== known.city) updates.city = known.city
    if (dbComm.url !== known.url) updates.url = known.url
    if (dbComm.state !== known.state) updates.state = known.state

    if (Object.keys(updates).length > 0) {
      dbComm = await prisma.community.update({ where: { id: dbComm.id }, data: updates })
      console.log(`  Updated [${dbComm.id}] "${known.name}": ${JSON.stringify(updates)}`)
    } else {
      console.log(`  Community [${dbComm.id}] "${known.name}" already up to date`)
    }
  } else {
    dbComm = await prisma.community.create({
      data: {
        builderId,
        name: known.name,
        city: known.city,
        state: known.state || "CA",
        url: known.url,
      },
    })
    console.log(`  Created [${dbComm.id}] "${known.name}" in ${known.city}`)
  }

  return dbComm
}

// -----------------------------------------------------------
// Upsert a listing
// For floor plans: address = "Plan X" (the plan name, unique per community)
// For MIR homes: address = normalized street address
// -----------------------------------------------------------
async function upsertListing(communityId, home) {
  // The address key: MIR homes use their street address; plans use plan name
  const rawAddr = home.address || home.floorPlan
  if (!rawAddr || rawAddr.length < 2) {
    console.log(`    Skipping listing with no address or plan name`)
    return null
  }
  const address = home.address ? normalizeAddress(rawAddr) : rawAddr

  const price = parsePriceInt(home.price)
  const sqft = parseIntSafe(home.sqft)
  const beds = parseFloatSafe(home.beds)
  const baths = parseFloatSafe(home.baths)
  const garages = parseIntSafe(home.garages)
  const floors = parseIntSafe(home.floors)
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  // Find existing listing
  let existing = await prisma.listing.findFirst({ where: { communityId, address } })
  if (!existing) {
    const all = await prisma.listing.findMany({ where: { communityId } })
    existing = all.find((l) => l.address.toLowerCase() === address.toLowerCase()) || null
  }

  const data = {
    address,
    floorPlan: home.floorPlan || null,
    sqft,
    beds,
    baths,
    garages,
    floors,
    currentPrice: price,
    pricePerSqft,
    hoaFees: parseIntSafe(home.hoaFees),
    moveInDate: home.moveInDate || null,
    status: home.status || "active",
    sourceUrl: home.sourceUrl || null,
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
      console.log(`    Updated [${existing.id}] ${address}: $${oldPrice?.toLocaleString() ?? "?"} → $${price.toLocaleString()}`)
    } else {
      console.log(`    Refreshed [${existing.id}] ${address}: $${price?.toLocaleString() ?? "N/A"}`)
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
      `    Created [${created.id}] ${address} | plan=${home.floorPlan ?? "-"} | $${price?.toLocaleString() ?? "N/A"} | ${beds}bd ${baths}ba ${sqft}sqft | garages=${garages} | ${home.status}`
    )
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("TRI Pointe Homes OC Scraper")
  console.log("=".repeat(60))

  // Find builder
  let builder = await prisma.builder.findFirst({
    where: { name: { contains: "TRI Pointe", mode: "insensitive" } },
  })
  if (!builder) {
    const all = await prisma.builder.findMany({ select: { id: true, name: true } })
    console.error("Error: TRI Pointe Homes builder not found. Available:", all)
    process.exit(1)
  }
  console.log(`\nBuilder: [${builder.id}] ${builder.name}`)

  // Step 1
  await markGarbageListings()

  // Step 2
  await fixListing211(builder.id)

  // Step 3
  await cleanupBadData(builder.id)

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })
  const page = await context.newPage()

  try {
    // Step 4: Upsert communities + scrape listings for each
    console.log("\n[Step 4] Upserting communities and scraping listings...")
    const summary = []

    for (const known of KNOWN_COMMUNITIES) {
      console.log(`\n${"─".repeat(55)}`)
      console.log(`Community: ${known.name} (${known.city})`)
      console.log(`  URL: ${known.url}`)

      // Upsert community with authoritative data
      const dbComm = await upsertCommunity(builder.id, known)

      // Scrape community page
      const rawListings = await scrapeCommunityPage(page, known)

      // Upsert each listing
      let createdCount = 0
      let updatedCount = 0
      const seenAddrKeys = new Set()

      // Get active DB listings for sold detection
      const activeDbListings = await prisma.listing.findMany({
        where: { communityId: dbComm.id, status: "active" },
        select: { id: true, address: true },
      })

      for (const listing of rawListings) {
        // For plans, use plan name as address key; for MIR homes use street address
        const addrKey = listing.isMIR
          ? (listing.address ? normalizeAddress(listing.address) : null)
          : listing.floorPlan

        if (!addrKey) continue

        seenAddrKeys.add(addrKey)

        const before = await prisma.listing.findFirst({
          where: { communityId: dbComm.id, address: addrKey },
        })

        await upsertListing(dbComm.id, listing)

        if (!before) createdCount++
        else updatedCount++
      }

      // Mark listings no longer on site as removed (sold)
      let removedCount = 0
      for (const dbL of activeDbListings) {
        if (!seenAddrKeys.has(dbL.address)) {
          await prisma.listing.update({ where: { id: dbL.id }, data: { status: "removed", soldAt: new Date() } })
          console.log(`    ✗ Marked removed [${dbL.id}] "${dbL.address}" (not in scraped response)`)
          removedCount++
        }
      }

      summary.push({
        name: known.name,
        city: known.city,
        communityId: dbComm.id,
        scraped: rawListings.length,
        created: createdCount,
        updated: updatedCount,
      })

      await new Promise((r) => setTimeout(r, 600))
    }

    // Step 5: MIR tab — catch any MIR homes not already handled
    console.log(`\n${"─".repeat(55)}`)
    const mirListings = await scrapeMIRTab(page, builder.id)

    for (const mir of mirListings) {
      // Find the community by matching URL that ends with the community slug (not a listing URL)
      // Use exact suffix match: url ends with /ca/orange-county/{commSlug}
      const expectedCommUrl = `${BASE_URL}/ca/orange-county/${mir.commSlug}`
      const dbComm = await prisma.community.findFirst({
        where: {
          builderId: builder.id,
          url: expectedCommUrl,
        },
      })

      if (!dbComm) {
        console.log(`  Warning: no community found for slug "${mir.commSlug}" — skipping "${mir.address}"`)
        continue
      }

      const normAddr = normalizeAddress(mir.address)
      const existing = await prisma.listing.findFirst({
        where: { communityId: dbComm.id, address: normAddr },
      })

      if (existing) {
        // Ensure it's active and price is current
        const updates = {}
        if (existing.status !== "active") updates.status = "active"
        if (mir.price && existing.currentPrice !== mir.price) updates.currentPrice = mir.price
        if (Object.keys(updates).length > 0) {
          await prisma.listing.update({ where: { id: existing.id }, data: updates })
          console.log(`  MIR [${existing.id}] "${mir.address}" updated: ${JSON.stringify(updates)}`)
        } else {
          console.log(`  MIR [${existing.id}] "${mir.address}" already up to date`)
        }
      } else {
        console.log(`  New MIR listing in "${dbComm.name}": "${mir.address}"`)
        await upsertListing(dbComm.id, mir)
      }
    }

    // ─── Summary ─────────────────────────────────────────────
    console.log("\n" + "=".repeat(60))
    console.log("SUMMARY")
    console.log("=".repeat(60))
    console.log(`Garbage listings [110, 210] → status=removed`)
    console.log(`Listing [211] (31680 Williams) → community "${HEATHERLY_COMMUNITY_NAME}"`)
    console.log()

    for (const s of summary) {
      console.log(`${s.name} (${s.city}) [community id=${s.communityId}]`)
      console.log(`  Scraped: ${s.scraped} | Created: ${s.created} | Updated: ${s.updated}`)
    }
    const totalScraped = summary.reduce((a, b) => a + b.scraped, 0)
    console.log(`\nTotal listings scraped: ${totalScraped}`)

    // ─── Final DB state ───────────────────────────────────────
    console.log("\n[Final DB state — all TRI Pointe communities + listings]")
    const triComms = await prisma.community.findMany({
      where: { builderId: builder.id },
      include: {
        listings: {
          select: {
            id: true,
            address: true,
            floorPlan: true,
            beds: true,
            baths: true,
            sqft: true,
            garages: true,
            currentPrice: true,
            hoaFees: true,
            moveInDate: true,
            status: true,
            lotNumber: true,
            sourceUrl: true,
          },
          orderBy: [{ status: "asc" }, { currentPrice: "asc" }],
        },
      },
      orderBy: { id: "asc" },
    })

    for (const comm of triComms) {
      const active = comm.listings.filter((l) => l.status !== "removed")
      const removed = comm.listings.filter((l) => l.status === "removed")
      console.log(`\n${comm.name} (${comm.city}, ${comm.state}) [id=${comm.id}]`)
      console.log(`  URL: ${comm.url}`)
      console.log(`  Active: ${active.length} | Removed: ${removed.length}`)
      for (const l of comm.listings) {
        const price = l.currentPrice != null ? `$${l.currentPrice.toLocaleString()}` : "N/A"
        console.log(
          `  [${l.id}] ${l.address} | plan=${l.floorPlan ?? "-"} | ${price} | ${l.beds ?? "?"}bd ${l.baths ?? "?"}ba ${l.sqft ?? "?"}sqft | garages=${l.garages ?? "?"} | ${l.status}`
        )
      }
    }
  } finally {
    await page.close()
    await browser.close()
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
