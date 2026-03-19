/**
 * Melia Homes Orange County Scraper
 *
 * Fixes bad placeholder data for 3 Melia OC communities:
 *   - id 130 "Breckyn"              — address = community name, no price
 *   - id 131 "Cerise at Citrus Square" — address = community name, suspicious price
 *   - id 132 "Townes at"            — truncated name, address = community name
 *
 * Steps:
 *   1. Mark fake placeholder listings 130, 131, 132 as status='removed'
 *   2. Fix community name "Townes at" → "Townes at Orange" and update URLs
 *   3. For each community URL, scrape real available home listings
 *   4. Upsert real listing records
 *
 * Run: node --env-file=.env.local scripts/scrape-melia.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// The 3 fake placeholder listing IDs to remove
const FAKE_LISTING_IDS = [130, 131, 132]

// Known Melia OC communities to scrape
// Note: /communities/ URLs redirect to /new-homes/ca/... — use the final URLs directly
const MELIA_COMMUNITIES = [
  {
    name: "Breckyn",
    city: "Garden Grove",
    state: "CA",
    url: "https://meliahomes.com/new-homes/ca/garden-grove/breckyn/",
  },
  {
    name: "Cerise at Citrus Square",
    city: "Cypress",
    state: "CA",
    url: "https://meliahomes.com/new-homes/ca/cypress/cerise-at-citrus-square/",
  },
  {
    name: "Townes at Orange",
    city: "Anaheim",
    state: "CA",
    url: "https://meliahomes.com/new-homes/ca/anaheim/townes-at-orange/",
  },
]

// Street suffix stripping for address normalization
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?(\s+(Unit|Apt|#)\s*\S+)?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(STREET_SUFFIXES, (match, suffix, unitPart) => {
      // Keep the unit part if present
      return unitPart ? unitPart : ""
    })
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceInt(val) {
  if (!val && val !== 0) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (!val && val !== 0) return null
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function parseIntSafe(val) {
  if (!val && val !== 0) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function toTitleCase(str) {
  if (!str) return ""
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

// -----------------------------------------------------------
// Step 1: Mark fake placeholder listings as removed
// -----------------------------------------------------------
async function removeFakeListings() {
  console.log("\n[Step 1] Marking fake placeholder listings as removed...")
  for (const id of FAKE_LISTING_IDS) {
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { community: true },
    })
    if (!listing) {
      console.log(`  Listing [${id}] not found — already removed or never existed`)
      continue
    }
    if (listing.status === "removed") {
      console.log(`  Listing [${id}] "${listing.address}" already removed`)
      continue
    }
    await prisma.listing.update({
      where: { id },
      data: { status: "removed" },
    })
    console.log(
      `  Marked listing [${id}] "${listing.address}" as removed (community: "${listing.community.name}")`
    )
  }
}

// -----------------------------------------------------------
// Step 2: Fix community records — names, cities, URLs
// -----------------------------------------------------------
async function fixCommunities(meliaBuilder) {
  console.log("\n[Step 2] Fixing Melia community records...")

  for (const comm of MELIA_COMMUNITIES) {
    // "Townes at Orange" may exist as "Townes at" in DB — look for both
    const namesToTry =
      comm.name === "Townes at Orange" ? ["Townes at Orange", "Townes at"] : [comm.name]

    let dbComm = null
    for (const tryName of namesToTry) {
      dbComm = await prisma.community.findFirst({
        where: { builderId: meliaBuilder.id, name: tryName },
      })
      if (dbComm) break
    }

    if (dbComm) {
      const needsUpdate =
        dbComm.name !== comm.name ||
        dbComm.city !== comm.city ||
        dbComm.url !== comm.url ||
        dbComm.state !== comm.state

      if (needsUpdate) {
        await prisma.community.update({
          where: { id: dbComm.id },
          data: {
            name: comm.name,
            city: comm.city,
            state: comm.state,
            url: comm.url,
          },
        })
        console.log(
          `  Fixed community [${dbComm.id}]: "${dbComm.name}" → "${comm.name}", city="${dbComm.city}" → "${comm.city}", url updated`
        )
      } else {
        console.log(`  Community [${dbComm.id}] "${comm.name}" already correct`)
      }
    } else {
      const created = await prisma.community.create({
        data: {
          builderId: meliaBuilder.id,
          name: comm.name,
          city: comm.city,
          state: comm.state,
          url: comm.url,
        },
      })
      console.log(`  Created community [${created.id}] "${comm.name}" in ${comm.city}`)
    }
  }
}

// -----------------------------------------------------------
// Parse listing blocks from the availability section innerText (Node.js side).
// The section's innerText looks like (each listing appears 3x, last occurrence
// is the full row that ends with "$PRICE\n\nDetails" or just "$PRICE"):
//
//   9001 Cerise Lane, Unit 109
//   Cypress, CA 90630
//
//   Bedrooms:
//   1 Bedrooms
//   Bathrooms:
//   1.0 Bathrooms
//   Square Feet:
//   763 Square Feet
//
//   Condominium
//
//   $450,000
//
// We split by "$NNN,NNN" price lines and work backwards from each to find the address.
// -----------------------------------------------------------
function parseAvailabilityText(rawText, detailLinks, communityUrl) {
  if (!rawText || !rawText.trim()) return []

  const lines = rawText.split(/\r?\n/).map((l) => l.trim())
  const results = []
  const seen = new Set()
  let linkIdx = 0

  // Find every line that is a price ($NNN,NNN)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^\$[\d,]+$/.test(line)) continue

    const price = parseInt(line.replace(/[^0-9]/g, ""), 10)
    if (!price || price < 100000) continue

    // Work backwards from this price line to find address, beds, baths, sqft
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
      // Address line: starts with digits, has a street name and optionally Unit/Apt
      if (/^\d+\s+\w/.test(l) && !l.match(/,\s*CA\s+\d{5}/) && !l.match(/Bedrooms|Bathrooms|Square|\$/)) {
        address = toTitleCase(l)
        break
      }
    }

    if (!address) continue
    if (seen.has(address)) continue
    seen.add(address)

    const sourceUrl = detailLinks[linkIdx] || communityUrl
    // Only advance link index when this is the first time we see this price (3 reps but only 1 Details link)
    linkIdx++

    results.push({
      address,
      price,
      beds,
      baths,
      sqft,
      floorPlan,
      sourceUrl,
    })
  }

  // Deduplicate — take first occurrence of each address
  const final = []
  const finalSeen = new Set()
  for (const r of results) {
    if (!finalSeen.has(r.address)) {
      finalSeen.add(r.address)
      final.push(r)
    }
  }
  return final
}

// -----------------------------------------------------------
// Step 3: Scrape a Melia community page for available homes
// Uses DOM selector approach: finds #availability section, then extracts
// listing cards via heading + sibling price/beds/baths/sqft elements.
// -----------------------------------------------------------
async function scrapeCommunityPage(context, community) {
  console.log(`\n  Scraping: ${community.url}`)
  const page = await context.newPage()

  try {
    await page.goto(community.url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    // Scroll to trigger lazy-loaded availability section
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(2000)

    // Extract the raw text of the availability section and all Details link hrefs,
    // then parse in Node.js (avoids browser sandbox regex issues).
    const { sectionText, detailLinks } = await page.evaluate(() => {
      // Find section with id="availability"
      let availSection = document.getElementById("availability")

      // Fallback: find any section/region with price + bed/sqft data
      if (!availSection || !(availSection.innerText || "").match(/\$[\d,]+/)) {
        const allSections = Array.from(document.querySelectorAll("section, [role='region']"))
        const fallback = allSections.find((s) => {
          const txt = s.innerText || ""
          return /\$[\d,]+/.test(txt) && /Bedrooms/.test(txt) && /Square Feet/.test(txt)
        })
        if (fallback) availSection = fallback
      }

      const sectionText = availSection ? (availSection.innerText || "") : ""

      // All "Details" links on the page
      const detailLinks = Array.from(document.querySelectorAll("a"))
        .filter((a) => a.textContent.trim() === "Details")
        .map((a) => {
          const href = a.getAttribute("href") || ""
          return href.startsWith("http") ? href : "https://meliahomes.com" + href
        })

      return { sectionText, detailLinks }
    })

    // Parse the section text in Node.js
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

// -----------------------------------------------------------
// Step 4: Upsert a listing in DB
// -----------------------------------------------------------
async function upsertListing(communityId, home) {
  // Build normalized address — keep "Unit X" suffix intact
  let address = home.address || ""
  if (!address) return null

  // Strip street type suffix but preserve unit number
  // e.g. "9001 Cerise Lane, Unit 109" → "9001 Cerise, Unit 109"
  // e.g. "2211 W Orange Ave Unit 21" → "2211 W Orange, Unit 21"
  address = address
    .replace(/,?\s+(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?(?=\s+(Unit|Apt|#|$))/i, "")
    .replace(/\s+/g, " ")
    .trim()

  if (!address) return null

  const price = home.currentPrice ?? home.price ?? null
  const sqft = home.sqft || null
  const beds = home.beds != null ? home.beds : null
  const baths = home.baths != null ? home.baths : null
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  // Find existing by communityId + address (case-insensitive)
  const all = await prisma.listing.findMany({ where: { communityId } })
  const existing = all.find(
    (l) => l.address.toLowerCase() === address.toLowerCase()
  ) || null

  const data = {
    address,
    floorPlan: home.floorPlan || null,
    sqft,
    beds,
    baths,
    currentPrice: price,
    pricePerSqft,
    status: "active",
    sourceUrl: home.sourceUrl,
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
      console.log(
        `    Updated [${existing.id}] ${address}: $${oldPrice?.toLocaleString()} → $${price?.toLocaleString()}`
      )
    } else {
      console.log(`    Refreshed [${existing.id}] ${address}: $${price?.toLocaleString()}`)
    }
    return existing.id
  } else {
    const created = await prisma.listing.create({
      data: { communityId, ...data },
    })
    if (price) {
      await prisma.priceHistory.create({
        data: { listingId: created.id, price, changeType: "initial" },
      })
    }
    console.log(
      `    Created [${created.id}] ${address} | ${home.floorPlan || "—"} | $${price?.toLocaleString()} | ${beds}bd ${baths}ba ${sqft}sqft`
    )
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Melia Homes OC Scraper")
  console.log("=".repeat(60))

  // Find Melia Homes builder
  const meliaBuilder = await prisma.builder.findFirst({
    where: { name: { contains: "Melia", mode: "insensitive" } },
  })
  if (!meliaBuilder) {
    console.error("Error: Could not find Melia Homes builder in DB")
    const all = await prisma.builder.findMany({ select: { id: true, name: true } })
    console.log("Available builders:")
    all.forEach((b) => console.log(`  [${b.id}] ${b.name}`))
    process.exit(1)
  }
  console.log(`\nBuilder: [${meliaBuilder.id}] ${meliaBuilder.name}`)

  // Step 1: Mark fake listings as removed
  await removeFakeListings()

  // Step 2: Fix community names, cities, URLs
  await fixCommunities(meliaBuilder)

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const browserContext = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  const summary = []

  try {
    for (const comm of MELIA_COMMUNITIES) {
      console.log(`\n${"─".repeat(56)}`)
      console.log(`Community: ${comm.name} (${comm.city}, ${comm.state})`)
      console.log(`URL: ${comm.url}`)

      // Get DB community record
      const dbComm = await prisma.community.findFirst({
        where: { builderId: meliaBuilder.id, name: comm.name },
      })
      if (!dbComm) {
        console.warn(`  Warning: DB community not found for "${comm.name}" — skipping`)
        continue
      }
      console.log(`  DB community id: ${dbComm.id}`)

      // Scrape the page
      const homes = await scrapeCommunityPage(browserContext, comm)
      console.log(`  Total listings found: ${homes.length}`)

      if (homes.length === 0) {
        console.log(`  No available inventory listed on site for this community`)
        summary.push({ community: comm.name, communityId: dbComm.id, scraped: 0, upserted: 0 })
        continue
      }

      // Upsert listings
      console.log(`\n  [Upserting listings]`)
      let upserted = 0
      for (const home of homes) {
        const id = await upsertListing(dbComm.id, home)
        if (id) upserted++
      }

      summary.push({ community: comm.name, communityId: dbComm.id, scraped: homes.length, upserted })
      await new Promise((r) => setTimeout(r, 1000))
    }
  } finally {
    await browser.close()
  }

  // Final summary
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Fake listings marked removed: ${FAKE_LISTING_IDS.join(", ")}`)
  console.log()
  let totalCreated = 0
  for (const s of summary) {
    console.log(`${s.community} [community id=${s.communityId}]`)
    console.log(`  Scraped: ${s.scraped} | Upserted: ${s.upserted}`)
    totalCreated += s.upserted
  }
  console.log(`\nTotal listings created/updated: ${totalCreated}`)

  // Final DB state for all Melia communities
  console.log("\n[Final DB state — all Melia OC listings]")
  for (const comm of MELIA_COMMUNITIES) {
    const dbComm = await prisma.community.findFirst({
      where: { builderId: meliaBuilder.id, name: comm.name },
    })
    if (!dbComm) continue

    const listings = await prisma.listing.findMany({
      where: { communityId: dbComm.id },
      select: {
        id: true, address: true, floorPlan: true, beds: true, baths: true,
        sqft: true, currentPrice: true, hoaFees: true, moveInDate: true,
        lotNumber: true, status: true,
      },
      orderBy: { currentPrice: "asc" },
    })

    console.log(
      `\n${dbComm.name} (${dbComm.city}) [id=${dbComm.id}] — ${listings.length} total listing(s):`
    )
    for (const l of listings) {
      console.log(
        `  [${l.id}] ${l.status.toUpperCase()} | ${l.address} | ${l.floorPlan || "—"} | $${l.currentPrice?.toLocaleString() || "—"} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft`
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
