/**
 * Taylor Morrison OC Scraper
 *
 * For each known OC community URL:
 *   1. Navigates to the /available-homes sub-page
 *   2. Extracts the embedded JSON data from a <script> tag
 *      (TM embeds all listing data as a raw JSON blob in a <script> tag —
 *       no need to scrape individual detail pages)
 *   3. Inserts community + listing records into the DB
 *
 * Also:
 *   - Deletes the 6 fake "community-as-address" listings (ids 223,224,226,227,228,231)
 *   - Creates proper community records for each TM OC community
 *
 * Run: node --env-file=.env.local scripts/scrape-taylor-morrison.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Fake listing IDs to delete (community-name-as-address placeholders)
const FAKE_LISTING_IDS = [223, 224, 226, 227, 228, 231]

// OC communities to scrape
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

// Street suffix stripping
const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(STREET_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Map TM availabilityStatus codes to human-readable status
function mapStatus(statusCode, sectionLabel) {
  const label = (sectionLabel || "").toLowerCase()
  if (label.includes("ready now")) return "active"
  if (label.includes("quick move")) return "active"
  if (label.includes("under construction")) return "active"
  if (label.includes("coming soon")) return "coming_soon"
  // fallback on code: 0=available, 1=reserved, 2=sold, 3=coming soon
  const code = parseInt(statusCode, 10)
  if (code === 0) return "active"
  if (code === 1) return "reserved"
  if (code === 2) return "sold"
  if (code === 3) return "coming_soon"
  return "active"
}

// -----------------------------------------------------------
// Step 1: Delete fake listings
// -----------------------------------------------------------
async function deleteFakeListings() {
  console.log("\n[Step 1] Removing fake placeholder listings...")
  for (const id of FAKE_LISTING_IDS) {
    const listing = await prisma.listing.findUnique({ where: { id } })
    if (!listing) {
      console.log(`  Listing [${id}] not found — already deleted or never existed`)
      continue
    }
    // Delete price history first (FK constraint)
    await prisma.priceHistory.deleteMany({ where: { listingId: id } })
    await prisma.userFavorite.deleteMany({ where: { listingId: id } })
    await prisma.listing.delete({ where: { id } })
    console.log(`  Deleted listing [${id}]: "${listing.address}"`)
  }
}

// -----------------------------------------------------------
// Step 2: Scrape available-homes page for a community
// -----------------------------------------------------------
async function scrapeAvailableHomes(browser, community) {
  const availUrl = community.url + "/available-homes"
  console.log(`\n  Scraping: ${availUrl}`)

  const page = await browser.newPage()
  try {
    await page.goto(availUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Scroll to trigger lazy loads
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(600)
    }

    // Extract the embedded JSON from the <script> tag
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
              sectionLabel: section.sectionLabel,
              address: home.address || null,
              homeSite: home.homeSite || null,
              floorPlan: home.floorPlan || null,
              sqft: home.sqft || null,
              bed: home.bed || null,
              totalBath: home.totalBath || null,
              fullBath: home.fullBath || null,
              halfBath: home.halfBath || null,
              garages: home.garages || null,
              price: home.price || null,
              hoaDues: home.hoaDues || null,
              city: home.city || null,
              state: home.state || null,
              zip: home.zip || null,
              readyDate: home.readyDate || null,
              availabilityStatus: home.availabilityStatus || null,
              isModelHome: home.isModelHome || false,
              homeReserved: home.homeReserved || false,
              viewHomeLink: home.viewHomeLink?.Url || null,
            })
          }
        }
        return allHomes
      } catch (e) {
        return { error: e.message }
      }
    })

    if (!result) {
      console.log(`  No availableHomesList script found on page`)
      return []
    }
    if (result.error) {
      console.log(`  JSON parse error: ${result.error}`)
      return []
    }

    console.log(`  Found ${result.length} listings across all sections`)
    result.forEach((h) =>
      console.log(
        `    [${h.sectionLabel}] ${h.address} | ${h.floorPlan} | $${h.price} | ${h.bed}bd ${h.totalBath}ba ${h.sqft}sqft | HOA $${h.hoaDues} | ready: ${h.readyDate}`
      )
    )
    return result
  } catch (err) {
    console.warn(`  Warning: Failed to scrape ${availUrl}: ${err.message}`)
    return []
  } finally {
    await page.close()
  }
}

// -----------------------------------------------------------
// Step 3: Upsert community in DB
// -----------------------------------------------------------
async function upsertCommunity(builderId, comm) {
  // Check if exists by builderId + name
  let dbComm = await prisma.community.findFirst({
    where: { builderId, name: comm.name },
  })

  if (dbComm) {
    // Fix city/URL if wrong
    if (dbComm.city !== comm.city || dbComm.url !== comm.url || dbComm.state !== comm.state) {
      dbComm = await prisma.community.update({
        where: { id: dbComm.id },
        data: { city: comm.city, state: comm.state, url: comm.url },
      })
      console.log(`  Updated community [${dbComm.id}] "${comm.name}": city/url corrected`)
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

  const address = normalizeAddress(rawAddr)
  const price = home.price ? parseInt(home.price, 10) : null
  const sqft = home.sqft ? parseInt(home.sqft, 10) : null
  const beds = home.bed != null ? parseFloat(home.bed) : null
  const baths = home.totalBath != null ? parseFloat(home.totalBath) : null
  const garages = home.garages != null ? parseInt(home.garages, 10) : null
  const hoaFees = home.hoaDues != null ? parseInt(home.hoaDues, 10) : null
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null
  const status = home.homeReserved ? "reserved" : mapStatus(home.availabilityStatus, home.sectionLabel)
  const sourceUrl = home.viewHomeLink
    ? `https://www.taylormorrison.com${home.viewHomeLink}`
    : communityUrl + "/available-homes"

  // Try find existing by communityId + address
  let existing = await prisma.listing.findFirst({
    where: { communityId, address },
  })

  // Fallback: try normalized match
  if (!existing) {
    const all = await prisma.listing.findMany({ where: { communityId } })
    existing = all.find(
      (l) => normalizeAddress(l.address).toLowerCase() === address.toLowerCase()
    ) || null
  }

  const data = {
    address,
    lotNumber: home.homeSite || null,
    floorPlan: home.floorPlan || null,
    sqft,
    beds,
    baths,
    garages,
    currentPrice: price,
    pricePerSqft,
    hoaFees,
    moveInDate: home.readyDate || null,
    status,
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
    const created = await prisma.listing.create({
      data: { communityId, ...data },
    })
    if (price) {
      await prisma.priceHistory.create({
        data: { listingId: created.id, price, changeType: "initial" },
      })
    }
    console.log(
      `    Created [${created.id}] ${address} | ${home.floorPlan} | $${price} | ${beds}bd ${baths}ba ${sqft}sqft | HOA $${hoaFees} | lot ${home.homeSite} | ready: ${home.readyDate}`
    )
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Taylor Morrison OC Scraper")
  console.log("=".repeat(60))

  // Find Taylor Morrison builder
  const builder = await prisma.builder.findFirst({
    where: { name: { contains: "Taylor Morrison", mode: "insensitive" } },
  })
  if (!builder) {
    console.error("Error: Could not find Taylor Morrison builder in DB")
    console.log("Available builders:")
    const all = await prisma.builder.findMany({ select: { id: true, name: true } })
    all.forEach((b) => console.log(`  [${b.id}] ${b.name}`))
    process.exit(1)
  }
  console.log(`\nBuilder: [${builder.id}] ${builder.name}`)

  // Step 1: Delete fake listings
  await deleteFakeListings()

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })

  const summary = []

  try {
    for (const comm of TM_COMMUNITIES) {
      console.log(`\n${"─".repeat(50)}`)
      console.log(`Community: ${comm.name} (${comm.city}, ${comm.state})`)

      // Upsert community
      console.log("\n[Upsert community]")
      const dbComm = await upsertCommunity(builder.id, comm)

      // Scrape available homes
      console.log("\n[Scrape listings]")
      const homes = await scrapeAvailableHomes(context, comm)

      // Upsert each listing
      let created = 0, updated = 0, skipped = 0
      if (homes.length > 0) {
        console.log("\n[Upsert listings]")
        for (const home of homes) {
          const id = await upsertListing(dbComm.id, home, comm.url)
          if (id) {
            // Check if it was a create or update
            const listing = await prisma.listing.findUnique({ where: { id } })
            if (listing?.firstDetected && listing.firstDetected.getTime() === listing.lastUpdated.getTime()) {
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

      await new Promise((r) => setTimeout(r, 1000)) // polite delay
    }
  } finally {
    await browser.close()
  }

  // Print summary
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Fake listings deleted: ${FAKE_LISTING_IDS.length} (ids: ${FAKE_LISTING_IDS.join(", ")})`)
  console.log()
  for (const s of summary) {
    console.log(`${s.community} (${s.city}) [community id=${s.communityId}]`)
    console.log(`  Scraped: ${s.scraped} | Created: ${s.created} | Updated: ${s.updated} | Skipped: ${s.skipped}`)
  }
  const totalScraped = summary.reduce((a, b) => a + b.scraped, 0)
  console.log(`\nTotal listings scraped: ${totalScraped}`)

  // Final DB state
  console.log("\n[Final DB state — all TM OC listings]")
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
        status: true,
        lotNumber: true,
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
