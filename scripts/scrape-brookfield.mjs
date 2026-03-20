/**
 * Brookfield Residential OC Scraper
 *
 * Findings:
 *   - Brookfield HAS an Orange County community: "Vista in Summit Collection"
 *     at Orchard Hills in Irvine, CA. (community URL under /orange-county/)
 *   - The LA County "Magnolia" community (Arcadia) is separate — listing 133 should
 *     be marked removed since we only track OC inventory.
 *
 * Steps:
 *   1. Mark listing 133 (fake LA County placeholder) as removed
 *   2. Upsert the real OC community "Vista in Summit Collection" in Irvine
 *   3. Scrape the 4 Quick Move-In homes and upsert them in DB
 *
 * Run: node --env-file=.env.local scripts/scrape-brookfield.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const BROOKFIELD_COMMUNITY_URL =
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit"

// The 4 known quick move-in home URLs (scraped from community page)
const QMI_URLS = [
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/536-peninsula-unit-000104",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/548-fieldhouse-unit-000024",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/536-sahara-unit-000026",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/540-sahara-unit-000025",
]

function toTitleCase(str) {
  if (!str) return ""
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseIntSafe(val) {
  if (!val && val !== 0) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (!val && val !== 0) return null
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

// Strip street suffix but preserve the street name (no unit for these addresses)
function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(/\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// -----------------------------------------------------------
// Scrape a single QMI detail page
// -----------------------------------------------------------
async function scrapeQmiPage(page, url) {
  console.log(`  Visiting: ${url}`)
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(3000)

  const data = await page.evaluate(() => {
    const bodyText = document.body?.innerText || ""

    // Address from the h1 / page title area
    const h1 = document.querySelector("h1, [class*='home-address'], [class*='address-heading']")
    let address = h1?.innerText?.trim().split("\n")[0] || ""

    // Fallback: extract from URL path (e.g. "536-peninsula" → "536 Peninsula")
    if (!address) {
      const pathParts = window.location.pathname.split("/")
      const slug = pathParts[pathParts.length - 1] || ""
      // Remove the unit suffix (unit-000104)
      const addrSlug = slug.replace(/-unit-\d+$/i, "")
      address = addrSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    }

    // Lot number from "Lot 104" or "unit-000104"
    const lotM = bodyText.match(/Lot[:\s]+(\w+)/i)
    let lotNumber = lotM ? lotM[1] : null
    if (!lotNumber) {
      const urlLot = window.location.pathname.match(/unit-0*(\d+)$/i)
      if (urlLot) lotNumber = urlLot[1]
    }

    // sqft
    const sqftM = bodyText.match(/([\d,]+)\s*ft\s*[²2]/i) || bodyText.match(/([\d,]+)\s*sq\s*ft/i)
    const sqft = sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : null

    // Beds
    const bedsM = bodyText.match(/([\d]+)\s*beds/i)
    const beds = bedsM ? parseFloat(bedsM[1]) : null

    // Baths
    const bathsM = bodyText.match(/([\d]+)\s*baths/i)
    const baths = bathsM ? parseFloat(bathsM[1]) : null

    // Stories / Floors — "Stories:" label on the page
    const storiesM = bodyText.match(/Stories:\s*([\d]+)/i) || bodyText.match(/([\d]+)\s*stories/i) || bodyText.match(/([\d]+)\s*story/i)
    const floors = storiesM ? parseInt(storiesM[1], 10) : null

    // Garage — "Parking/Garage: 2"
    const garM = bodyText.match(/Parking\/Garage:\s*([\d]+)/i) || bodyText.match(/([\d]+)\s*car\s*garage/i) || bodyText.match(/([\d]+)\s*garage/i)
    const garages = garM ? parseInt(garM[1], 10) : null

    // Plan name
    const planM = bodyText.match(/Plan:\s*([^\n]+)/i)
    const floorPlan = planM ? planM[1].trim() : null

    // Move-in date
    const moveInM = bodyText.match(/MOVE\s*IN\s+([A-Za-z]+\s+\d{4})/i)
    const moveInDate = moveInM ? moveInM[1] : null

    // Price — Brookfield uses "Call For Pricing" or "$X,XXX,XXX"
    const priceM = bodyText.match(/\$([\d,]+(?:\.\d+)?)/)
    const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null
    const callForPrice = /Call For Pricing/i.test(bodyText)

    // Property type
    let propertyType = null
    if (/single.family/i.test(bodyText)) propertyType = "Single Family"
    else if (/townhome|townhouse/i.test(bodyText)) propertyType = "Townhome"
    else if (/condo/i.test(bodyText)) propertyType = "Condo"

    return {
      address,
      lotNumber,
      sqft,
      beds,
      baths,
      floors,
      garages,
      floorPlan,
      moveInDate,
      price,
      callForPrice,
      propertyType,
    }
  })

  // Clean up address — Brookfield addresses are like "536 Peninsula"
  // (no suffix needed — they're custom street names)
  if (data.address) {
    data.address = normalizeAddress(toTitleCase(data.address))
  }

  // If address is still empty, derive from URL
  if (!data.address) {
    const slug = url.split("/").pop() || ""
    const addrSlug = slug.replace(/-unit-\d+$/i, "")
    data.address = addrSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  }

  console.log(`    Address: ${data.address} | ${data.floorPlan} | ${data.beds}bd ${data.baths}ba ${data.sqft}sqft | floors=${data.floors} garages=${data.garages} | move-in: ${data.moveInDate} | price: ${data.callForPrice ? "Call For Pricing" : "$" + data.price}`)
  return { ...data, sourceUrl: url }
}

// -----------------------------------------------------------
// Upsert listing
// -----------------------------------------------------------
async function upsertListing(communityId, home) {
  if (!home.address) return null

  const price = home.price || null
  const sqft = home.sqft || null
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  // Find existing
  const all = await prisma.listing.findMany({ where: { communityId } })
  const existing = all.find(l => l.address.toLowerCase() === home.address.toLowerCase()) || null

  const data = {
    address: home.address,
    lotNumber: home.lotNumber || null,
    floorPlan: home.floorPlan || null,
    sqft,
    beds: home.beds || null,
    baths: home.baths || null,
    garages: home.garages || null,
    floors: home.floors || null,
    currentPrice: price,
    pricePerSqft,
    propertyType: home.propertyType || null,
    moveInDate: home.moveInDate || null,
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
      console.log(`    Updated [${existing.id}] ${home.address}: $${oldPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
    } else {
      console.log(`    Refreshed [${existing.id}] ${home.address}: ${price ? "$" + price.toLocaleString() : "Call For Pricing"}`)
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
      `    Created [${created.id}] ${home.address} | ${home.floorPlan} | ${price ? "$" + price.toLocaleString() : "Call For Pricing"} | ${home.beds}bd ${home.baths}ba ${home.sqft}sqft`
    )
    return created.id
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Brookfield Residential OC Scraper")
  console.log("=".repeat(60))

  // Find Brookfield builder
  const builder = await prisma.builder.findFirst({
    where: { name: { contains: "Brookfield", mode: "insensitive" } },
  })
  if (!builder) {
    console.error("Error: Could not find Brookfield builder in DB")
    const all = await prisma.builder.findMany({ select: { id: true, name: true } })
    all.forEach(b => console.log(`  [${b.id}] ${b.name}`))
    process.exit(1)
  }
  console.log(`\nBuilder: [${builder.id}] ${builder.name}`)

  // -----------------------------------------------------------
  // Step 1: Mark listing 133 (LA County fake placeholder) as removed
  // Note: The "Magnolia" community is Arcadia (LA County) — not OC.
  // Brookfield DOES have an OC community (Vista in Summit, Irvine),
  // so we don't need listing 133 anymore.
  // -----------------------------------------------------------
  console.log("\n[Step 1] Marking LA County placeholder listing 133 as removed...")
  const listing133 = await prisma.listing.findUnique({ where: { id: 133 } })
  if (listing133) {
    if (listing133.status === "removed") {
      console.log("  Listing 133 already marked removed")
    } else {
      await prisma.listing.update({ where: { id: 133 }, data: { status: "removed" } })
      console.log(`  Marked listing 133 "${listing133.address}" as removed (LA County placeholder)`)
    }
  } else {
    console.log("  Listing 133 not found — may already be gone")
  }

  // -----------------------------------------------------------
  // Step 2: Upsert the real OC community "Vista in Summit Collection"
  // -----------------------------------------------------------
  console.log("\n[Step 2] Upserting Vista in Summit Collection community (Irvine, OC)...")
  let dbComm = await prisma.community.findFirst({
    where: {
      builderId: builder.id,
      name: { contains: "Vista in Summit", mode: "insensitive" },
    },
  })

  if (dbComm) {
    const needsUpdate =
      dbComm.city !== "Irvine" ||
      dbComm.state !== "CA" ||
      dbComm.url !== BROOKFIELD_COMMUNITY_URL

    if (needsUpdate) {
      dbComm = await prisma.community.update({
        where: { id: dbComm.id },
        data: { city: "Irvine", state: "CA", url: BROOKFIELD_COMMUNITY_URL },
      })
      console.log(`  Updated community [${dbComm.id}] "${dbComm.name}" → city=Irvine, url corrected`)
    } else {
      console.log(`  Community [${dbComm.id}] "${dbComm.name}" already correct`)
    }
  } else {
    dbComm = await prisma.community.create({
      data: {
        builderId: builder.id,
        name: "Vista in Summit Collection",
        city: "Irvine",
        state: "CA",
        url: BROOKFIELD_COMMUNITY_URL,
      },
    })
    console.log(`  Created community [${dbComm.id}] "Vista in Summit Collection" in Irvine, CA`)
  }

  // -----------------------------------------------------------
  // Step 3: Scrape and upsert the 4 QMI homes
  // -----------------------------------------------------------
  console.log(`\n[Step 3] Scraping ${QMI_URLS.length} Quick Move-In homes...`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  const scraped = []
  let page = null
  try {
    page = await context.newPage()
    for (const url of QMI_URLS) {
      try {
        const home = await scrapeQmiPage(page, url)
        scraped.push(home)
        await new Promise(r => setTimeout(r, 1500))
      } catch (err) {
        console.warn(`  Warning: Failed to scrape ${url}: ${err.message}`)
      }
    }
  } finally {
    if (page) await page.close()
    await browser.close()
  }

  console.log(`\n[Step 4] Upserting ${scraped.length} listings in DB...`)
  let upserted = 0
  for (const home of scraped) {
    const id = await upsertListing(dbComm.id, home)
    if (id) upserted++
  }

  // -----------------------------------------------------------
  // Final summary
  // -----------------------------------------------------------
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Brookfield OC community: "Vista in Summit Collection" (Irvine) [id=${dbComm.id}]`)
  console.log(`Note: LA County "Magnolia" community (Arcadia) is NOT tracked (not OC)`)
  console.log(`QMI homes scraped: ${scraped.length}`)
  console.log(`Listings upserted: ${upserted}`)

  const allListings = await prisma.listing.findMany({
    where: { communityId: dbComm.id },
    orderBy: { address: "asc" },
    select: {
      id: true, address: true, floorPlan: true, beds: true, baths: true,
      sqft: true, floors: true, garages: true, currentPrice: true,
      pricePerSqft: true, moveInDate: true, lotNumber: true, status: true,
    },
  })

  console.log(`\nAll listings in Vista in Summit Collection [community id=${dbComm.id}]:`)
  for (const l of allListings) {
    console.log(
      `  [${l.id}] ${l.status.toUpperCase()} | ${l.address} | ${l.floorPlan || "—"} | ${l.currentPrice ? "$" + l.currentPrice.toLocaleString() : "Call For Pricing"} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | floors=${l.floors} garages=${l.garages} | lot=${l.lotNumber} | move-in: ${l.moveInDate}`
    )
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
