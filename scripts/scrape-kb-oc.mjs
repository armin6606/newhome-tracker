/**
 * KB Home Orange County Scraper
 *
 * 1. Fetches the real OC community list from kbhome.com/new-homes-orange-county
 * 2. Fetches all Move-In Ready listings for OC from kbhome.com/move-in-ready?state=california&region=orange+county
 * 3. Visits each MIR detail page to capture full detail (HOA, taxes, move-in date, property type)
 * 4. Updates/creates DB communities with correct city and URL
 * 5. Upserts listings under the correct community
 * 6. Marks DB communities whose URL is NOT an OC URL as status='removed' on all their listings,
 *    and fixes their city field
 *
 * Run: node --env-file=.env.local scripts/scrape-kb-oc.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const KB_BUILDER_ID = 3
const BASE_URL = "https://www.kbhome.com"
const OC_REGION_URL = `${BASE_URL}/new-homes-orange-county`
const MIR_LIST_URL = `${BASE_URL}/move-in-ready?state=california&region=orange+county`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Street suffix stripping (for address normalization / matching)
const STREET_SUFFIXES =
  /\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(STREET_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceInt(str) {
  if (!str) return null
  const n = parseInt(str.replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(str) {
  if (!str) return null
  const n = parseFloat(str.replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function parseIntSafe(str) {
  if (!str) return null
  const n = parseInt(str.replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

// -----------------------------------------------------------
// Step 1: Get OC communities from window.regionMapData
// -----------------------------------------------------------
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

  // Filter to only genuine OC communities (PageUrl starts with /new-homes-orange-county/)
  const ocCommunities = data.communitiesData.filter(
    (c) => c.PageUrl && c.PageUrl.startsWith("/new-homes-orange-county/")
  )

  // Deduplicate by CommunityId
  const seen = new Set()
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

// -----------------------------------------------------------
// Step 2: Scrape all OC Move-In Ready listings from listing page
// -----------------------------------------------------------
async function getMIRListings(browser) {
  console.log("\n[Step 2] Fetching OC Move-In Ready listings...")
  const page = await browser.newPage()
  await page.goto(MIR_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(8000)

  // Scroll to load all
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3000)

  const listings = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".content-inner"))
    return cards
      .map((card) => {
        const link = card.querySelector("a[href*='/mir?homesite=']")
        const mirUrl = link?.getAttribute("href") || null

        // Address is usually the first text node or heading
        const addressEl = card.querySelector("h2, h3, .address, [class*='address']")
        let address = addressEl?.innerText?.trim() || ""
        if (!address) {
          // fallback: first line of text before community name
          const lines = (card.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
          address = lines[0] || ""
        }

        // Community and city: look for the paragraph or div after address
        const allText = (card.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
        let communityName = ""
        let cityState = ""
        let price = ""
        let beds = ""
        let baths = ""
        let sqft = ""
        let garages = ""
        let hotsiteLabel = ""

        allText.forEach((line, i) => {
          if (line.match(/^\$[\d,]+/)) price = line
          if (i === 1) communityName = line
          if (i === 2 && line.includes(",")) cityState = line
        })

        // Try structured extraction
        const detailsEl = card.querySelector(".details")
        if (detailsEl) {
          const detailText = detailsEl.innerText || ""
          const bedsM = detailText.match(/([\d.]+)\s*BEDS/i)
          const bathsM = detailText.match(/([\d.]+)\s*BATHS/i)
          const sqftM = detailText.match(/([\d,]+)\s*SQFT/i)
          const garM = detailText.match(/([\d]+)\s*CARS/i)
          if (bedsM) beds = bedsM[1]
          if (bathsM) baths = bathsM[1]
          if (sqftM) sqft = sqftM[1].replace(/,/g, "")
          if (garM) garages = garM[1]
        }

        // Homesite label
        const hsM = (card.innerText || "").match(/Homesite\s+(\w+)/i)
        if (hsM) hotsiteLabel = hsM[1]

        // Status
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

// -----------------------------------------------------------
// Step 3: Visit each MIR detail page for full data
// -----------------------------------------------------------
async function getMIRDetail(browser, mirPath) {
  const url = `${BASE_URL}${mirPath}`
  const page = await browser.newPage()
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    const detail = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""

      // Address: the main heading
      const h1 = document.querySelector("h1, .homesite-address, [class*='address-heading']")
      const address = h1?.innerText?.trim().split("\n")[0] || ""

      // Beds, Baths, Stories, Sqft, Garages from details block
      // The page uses "3\nBEDS" format (number on one line, label on next)
      const getMetric = (label) => {
        const re = new RegExp(`([\\d.,]+)\\s*\\n\\s*${label}`, "i")
        const m = bodyText.match(re)
        if (m) return m[1].replace(/,/g, "")
        // fallback: label on same line
        const re2 = new RegExp(`([\\d.,]+)\\s*${label}`, "i")
        const m2 = bodyText.match(re2)
        return m2 ? m2[1].replace(/,/g, "") : null
      }

      const beds = getMetric("BEDS")
      const baths = getMetric("BATHS")
      const stories = getMetric("STORIES")
      const sqft = getMetric("SQFT")
      const garages = getMetric("CARS")

      // Price: look for $xxx,xxx pattern — first occurrence after AVAILABLE NOW or just first $price
      const priceM = bodyText.match(/\$\s*([\d,]+)/)
      const price = priceM ? priceM[1].replace(/,/g, "") : null

      // City/State from breadcrumb or address line
      const breadcrumbs = Array.from(document.querySelectorAll("[class*='breadcrumb'] a, nav a"))
        .map((a) => a.innerText?.trim())
        .filter(Boolean)

      // Community name - often in a link near the address
      const communityLink = document.querySelector("a[href*='/new-homes-orange-county/']")
      const communityName = communityLink?.innerText?.trim() || ""

      // City from the page - look for "City, CA" pattern
      const cityM = bodyText.match(/([A-Za-z\s]+),\s*CA\s+\d{5}/)
      const city = cityM ? cityM[1].trim() : ""

      // Homesite / lot number
      const hsM = bodyText.match(/Homesite\s+(\w+)/i)
      const lotNumber = hsM ? hsM[1] : null

      // Move-in date - look for date patterns
      const moveInM = bodyText.match(
        /(?:move[- ]in|available|estimated[^:]*?:?)\s*([A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
      )
      const moveInDate = moveInM ? moveInM[1] : null

      // HOA - look for HOA fee pattern
      const hoaM = bodyText.match(/HOA[^$]*\$\s*([\d,]+)/i)
      const hoaFees = hoaM ? parseInt(hoaM[1].replace(/,/g, ""), 10) : null

      // Property type
      let propertyType = null
      if (bodyText.match(/condominium|condo/i)) propertyType = "Condo"
      else if (bodyText.match(/townhome|townhouse/i)) propertyType = "Townhome"
      else if (bodyText.match(/single.family/i)) propertyType = "Single Family"

      // Status
      const isAvailableNow = bodyText.includes("AVAILABLE NOW") || bodyText.includes("Available Now")

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

// -----------------------------------------------------------
// Step 4: Upsert communities and listings in DB
// -----------------------------------------------------------
async function upsertCommunity(ocCommunity) {
  const communityUrl = `${BASE_URL}${ocCommunity.PageUrl}`
  const city = ocCommunity.City
  const name = ocCommunity.CommunityName

  // Check if community exists by name (KB Home builder)
  let dbComm = await prisma.community.findFirst({
    where: { builderId: KB_BUILDER_ID, name },
  })

  if (dbComm) {
    // Update city and URL if wrong
    if (dbComm.city !== city || dbComm.url !== communityUrl) {
      await prisma.community.update({
        where: { id: dbComm.id },
        data: { city, url: communityUrl },
      })
      console.log(
        `  Updated community [${dbComm.id}] "${name}": city="${dbComm.city}"→"${city}", url corrected`
      )
      dbComm = { ...dbComm, city, url: communityUrl }
    } else {
      console.log(`  Community [${dbComm.id}] "${name}" already correct`)
    }
  } else {
    dbComm = await prisma.community.create({
      data: {
        builderId: KB_BUILDER_ID,
        name,
        city,
        state: "CA",
        url: communityUrl,
      },
    })
    console.log(`  Created new community [${dbComm.id}] "${name}" in ${city}`)
  }
  return dbComm
}

async function upsertListing(communityId, detail, mirPath) {
  const sourceUrl = `${BASE_URL}${mirPath}`
  const address = detail.address?.trim()
  if (!address) return null

  const normalAddr = normalizeAddress(address)
  const price = detail.price ? parseInt(detail.price, 10) : null
  const beds = detail.beds ? parseFloatSafe(detail.beds) : null
  const baths = detail.baths ? parseFloatSafe(detail.baths) : null
  const sqft = detail.sqft ? parseIntSafe(detail.sqft) : null
  const floors = detail.stories ? parseIntSafe(detail.stories) : null
  const garages = detail.garages ? parseIntSafe(detail.garages) : null
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  // Find existing by communityId + address (try both raw and normalized)
  let existing = await prisma.listing.findFirst({
    where: { communityId, address },
  })

  if (!existing) {
    // Try to find by normalized address
    const allListings = await prisma.listing.findMany({ where: { communityId } })
    existing = allListings.find(
      (l) => normalizeAddress(l.address).toLowerCase() === normalAddr.toLowerCase()
    )
  }

  const data = {
    address,
    lotNumber: detail.lotNumber || null,
    sqft,
    beds,
    baths,
    garages,
    floors,
    currentPrice: price,
    pricePerSqft,
    propertyType: detail.propertyType || null,
    hoaFees: detail.hoaFees || null,
    moveInDate: detail.moveInDate || null,
    status: "active",
    sourceUrl,
  }

  if (existing) {
    const oldPrice = existing.currentPrice
    await prisma.listing.update({ where: { id: existing.id }, data })
    if (oldPrice !== price && price) {
      await prisma.priceHistory.create({
        data: {
          listingId: existing.id,
          price,
          changeType: oldPrice ? (price > oldPrice ? "increase" : "decrease") : "initial",
        },
      })
      console.log(
        `    Updated listing [${existing.id}] ${address}: $${oldPrice}→$${price}`
      )
    } else {
      console.log(`    Refreshed listing [${existing.id}] ${address}: $${price}`)
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
    console.log(`    Created listing [${created.id}] ${address}: $${price}`)
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("KB Home Orange County Scraper")
  console.log("=".repeat(60))

  // Verify builder
  const builder = await prisma.builder.findUnique({ where: { id: KB_BUILDER_ID } })
  if (!builder || builder.name !== "KB Home") {
    console.error(`Error: Builder id=${KB_BUILDER_ID} is "${builder?.name}", expected "KB Home"`)
    process.exit(1)
  }
  console.log(`\nBuilder confirmed: [${builder.id}] ${builder.name}`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })

  const context = await browser.newContext({ userAgent: USER_AGENT })

  try {
    // ---------- Step 1: Get real OC communities ----------
    const ocCommunities = await getOCCommunities(context)

    // ---------- Step 2: Get MIR listings from listing page ----------
    const mirListings = await getMIRListings(context)

    // ---------- Step 3: For each MIR listing, visit detail page ----------
    console.log("\n[Step 3] Visiting individual MIR detail pages...")
    const detailedListings = []
    for (const listing of mirListings) {
      if (!listing.mirUrl) continue
      console.log(`  Visiting: ${listing.mirUrl}`)
      const detail = await getMIRDetail(context, listing.mirUrl)
      if (detail) {
        // Merge listing-page data as fallback
        detail.communityName = detail.communityName || listing.communityName
        detail.city = detail.city || (listing.cityState?.split(",")[0]?.trim()) || ""
        detail.beds = detail.beds || listing.beds
        detail.baths = detail.baths || listing.baths
        detail.sqft = detail.sqft || listing.sqft
        detail.garages = detail.garages || listing.garages
        detail.price = detail.price || listing.price?.replace(/[^0-9]/g, "")
        detail.isAvailableNow = detail.isAvailableNow || listing.isAvailableNow
        detail.mirPath = listing.mirUrl
        detailedListings.push(detail)
      }
      await new Promise((r) => setTimeout(r, 800)) // polite delay
    }

    // ---------- Step 4: Upsert communities ----------
    console.log("\n[Step 4] Upserting OC communities in DB...")
    const ocCommunityMap = new Map() // communityName → DB community id

    for (const ocComm of ocCommunities) {
      const dbComm = await upsertCommunity(ocComm)
      ocCommunityMap.set(ocComm.CommunityName.toLowerCase(), dbComm.id)
    }

    // ---------- Step 5: Upsert listings ----------
    console.log("\n[Step 5] Upserting listings...")
    const activeMirPaths = new Set()
    // Track scraped addresses per communityId for sold detection
    const scrapedAddrsByComm = new Map()
    for (const listing of detailedListings) {
      if (!listing.communityName) continue

      const communityId = ocCommunityMap.get(listing.communityName.toLowerCase())
      if (!communityId) {
        // Try partial match
        let matchedId = null
        for (const [name, id] of ocCommunityMap.entries()) {
          if (listing.communityName.toLowerCase().includes(name) || name.includes(listing.communityName.toLowerCase())) {
            matchedId = id
            break
          }
        }
        if (!matchedId) {
          console.warn(`  Warning: No DB community found for "${listing.communityName}" — skipping listing`)
          continue
        }
        ocCommunityMap.set(listing.communityName.toLowerCase(), matchedId)
      }

      const cId = ocCommunityMap.get(listing.communityName.toLowerCase()) || communityId
      if (!cId) continue

      // Only upsert if we have an address
      if (!listing.address) continue

      await upsertListing(cId, listing, listing.mirPath)
      activeMirPaths.add(listing.mirPath)
      if (!scrapedAddrsByComm.has(cId)) scrapedAddrsByComm.set(cId, new Set())
      scrapedAddrsByComm.get(cId).add(listing.address.trim())
    }

    // Mark listings no longer on site as removed (sold)
    console.log("\n[Step 5b] Checking for sold/removed listings...")
    let soldCount = 0
    for (const [commId, scrapedAddrs] of scrapedAddrsByComm.entries()) {
      const activeDbListings = await prisma.listing.findMany({
        where: { communityId: commId, status: "active" },
        select: { id: true, address: true },
      })
      for (const dbL of activeDbListings) {
        if (!scrapedAddrs.has(dbL.address)) {
          await prisma.listing.update({ where: { id: dbL.id }, data: { status: "removed", soldAt: new Date() } })
          console.log(`  ✗ Marked removed [${dbL.id}] "${dbL.address}" (not in scraped response)`)
          soldCount++
        }
      }
    }
    console.log(`  Total sold/removed: ${soldCount}`)

    // ---------- Step 6: Fix wrong-region communities ----------
    console.log("\n[Step 6] Fixing wrong-region KB communities in DB...")
    const allKBComms = await prisma.community.findMany({
      where: { builderId: KB_BUILDER_ID },
      include: { listings: true },
    })

    const ocNames = new Set(ocCommunities.map((c) => c.CommunityName.toLowerCase()))
    let removedCount = 0
    let alreadyWrong = 0

    for (const comm of allKBComms) {
      const isOC = comm.url.includes("/new-homes-orange-county/")
      const isRealOC = ocNames.has(comm.name.toLowerCase())

      if (!isOC && !isRealOC) {
        alreadyWrong++
        // Mark all listings in this community as removed
        const activeListings = comm.listings.filter((l) => l.status === "active")
        if (activeListings.length > 0) {
          await prisma.listing.updateMany({
            where: { communityId: comm.id, status: "active" },
            data: { status: "removed" },
          })
          console.log(
            `  Marked ${activeListings.length} listings as removed in wrong-region community "${comm.name}" (${comm.city}) [url: ${comm.url.slice(0, 60)}...]`
          )
          removedCount += activeListings.length
        } else {
          console.log(
            `  Wrong-region community "${comm.name}" already has no active listings`
          )
        }
      }
    }

    // ---------- Summary ----------
    console.log("\n" + "=".repeat(60))
    console.log("SUMMARY")
    console.log("=".repeat(60))
    console.log(`OC communities found on kbhome.com:  ${ocCommunities.length}`)
    console.log(`MIR listings scraped:                ${mirListings.length}`)
    console.log(`MIR detail pages visited:            ${detailedListings.length}`)
    console.log(`Listings upserted:                   ${activeMirPaths.size}`)
    console.log(`Wrong-region communities in DB:      ${alreadyWrong}`)
    console.log(`Listings marked removed:             ${removedCount}`)

    console.log("\nOC Communities upserted:")
    for (const [name, id] of ocCommunityMap.entries()) {
      console.log(`  [${id}] ${name}`)
    }

    console.log("\nAll listings now in DB for KB OC communities:")
    for (const [, id] of ocCommunityMap.entries()) {
      const listings = await prisma.listing.findMany({
        where: { communityId: id, status: "active" },
        select: { id: true, address: true, currentPrice: true, beds: true, baths: true, sqft: true, status: true },
      })
      if (listings.length > 0) {
        const comm = await prisma.community.findUnique({ where: { id }, select: { name: true, city: true } })
        console.log(`\n  ${comm?.name} (${comm?.city}) — ${listings.length} active listings:`)
        listings.forEach((l) =>
          console.log(
            `    [${l.id}] ${l.address} | $${l.currentPrice} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft`
          )
        )
      }
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
