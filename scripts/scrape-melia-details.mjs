/**
 * Melia Homes — Scrape detail pages for active OC listings
 *
 * Active listings (IDs 363-367):
 *   363: 9001 Cerise Lane, Unit 109 (Cerise at Citrus Square)
 *   364: 9001 Cerise Lane, Unit 113 (Cerise at Citrus Square)
 *   365: 9011 Cerise Lane, Unit 122 (Cerise at Citrus Square)
 *   366: 2211 W Orange Unit 21     (Townes at Orange)
 *   367: 2217 W. Orange Unit 17    (Townes at Orange)
 *
 * For each, visit the sourceUrl to extract:
 *   - HOA fees
 *   - Floors (stories)
 *   - sqft (if missing)
 *   - Move-in date / status
 *   - Schools
 *   - Garages
 *
 * Run: node --env-file=.env.local scripts/scrape-melia-details.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const MELIA_BUILDER_NAME = "Melia Homes"
const LISTING_IDS = [363, 364, 365, 366, 367]
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function parseIntSafe(str) {
  if (!str && str !== 0) return null
  const n = parseInt(String(str).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(str) {
  if (!str && str !== 0) return null
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

// -----------------------------------------------------------
// Scrape one Melia detail page
// -----------------------------------------------------------
async function scrapeMeliaDetailPage(page, url) {
  console.log(`  Visiting: ${url}`)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    // Scroll to trigger lazy-loaded sections
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 500))
      await page.waitForTimeout(600)
    }
    await page.waitForTimeout(1500)

    const data = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""
      const bodyHtml = document.body?.innerHTML || ""

      // -------------------------------------------------------
      // HOA fees — Melia typically shows "HOA: $NNN/mo" or
      // "$NNN HOA" or "HOA Fees: $NNN"
      // -------------------------------------------------------
      let hoaFees = null
      const hoaPatterns = [
        /HOA\s*(?:fees?|dues?|monthly)?[:\s]*\$\s*([\d,]+)/i,
        /\$([\d,]+)\s*\/\s*mo(?:nth)?\s*HOA/i,
        /\$([\d,]+)\s*HOA/i,
        /Homeowners?\s*Association[:\s]*\$\s*([\d,]+)/i,
        /Monthly\s*HOA[:\s]*\$\s*([\d,]+)/i,
      ]
      for (const re of hoaPatterns) {
        const m = bodyText.match(re)
        if (m) {
          hoaFees = parseInt(m[1].replace(/,/g, ""), 10)
          break
        }
      }

      // -------------------------------------------------------
      // Floors / Stories — look for "3 Story", "2 Stories", "Stories: 3"
      // -------------------------------------------------------
      let floors = null
      const floorPatterns = [
        /Stories?:\s*([\d]+)/i,
        /([\d]+)\s*[-–]?\s*Story\b/i,
        /([\d]+)\s*Stories\b/i,
        /Floors?:\s*([\d]+)/i,
        /([\d]+)\s*Floors?\b/i,
      ]
      for (const re of floorPatterns) {
        const m = bodyText.match(re)
        if (m) {
          floors = parseInt(m[1], 10)
          if (floors >= 1 && floors <= 5) break
          floors = null // reject implausible values
        }
      }

      // Check for "3 Story Townhome" type labels
      if (!floors) {
        const typeM = bodyText.match(/([\d])\s*Story\s+(?:Townhome|Condo|Home)/i)
        if (typeM) floors = parseInt(typeM[1], 10)
      }

      // -------------------------------------------------------
      // sqft — "763 Square Feet" or "763 sq ft"
      // -------------------------------------------------------
      const sqftM = bodyText.match(/([\d,]+)\s*Square\s*Feet/i) ||
        bodyText.match(/([\d,]+)\s*sq\.?\s*ft/i)
      const sqft = sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : null

      // -------------------------------------------------------
      // Garages
      // -------------------------------------------------------
      const garPatterns = [
        /Garages?:\s*([\d]+)/i,
        /([\d]+)\s*(?:Car|Stall)\s*Garage/i,
        /Parking:\s*([\d]+)/i,
        /([\d]+)\s*Garage\s*Space/i,
      ]
      let garages = null
      for (const re of garPatterns) {
        const m = bodyText.match(re)
        if (m) {
          garages = parseInt(m[1], 10)
          break
        }
      }

      // -------------------------------------------------------
      // Move-in date / status
      // -------------------------------------------------------
      let moveInDate = null
      const moveInPatterns = [
        /(?:move[- ]in|available|estimated)[^\n:]*:?\s*([A-Za-z]+\s+\d{4})/i,
        /(?:move[- ]in|available|estimated)[^\n:]*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
        /(?:move[- ]in|available|estimated)[^\n:]*:?\s*(Q[1-4]\s*\d{4})/i,
      ]
      for (const re of moveInPatterns) {
        const m = bodyText.match(re)
        if (m) {
          moveInDate = m[1].trim()
          break
        }
      }

      // Check availability status labels
      let statusLabel = null
      if (/quick\s+move.in/i.test(bodyText)) statusLabel = "Quick Move-In"
      else if (/ready\s+now/i.test(bodyText)) statusLabel = "Ready Now"
      else if (/under\s+construction/i.test(bodyText)) statusLabel = "Under Construction"
      else if (/coming\s+soon/i.test(bodyText)) statusLabel = "Coming Soon"

      // -------------------------------------------------------
      // Schools — Melia often lists school names on detail pages
      // -------------------------------------------------------
      let schools = null
      const schoolSection = bodyText.match(
        /(?:schools?|district)[^\n]*\n((?:[^\n]+\n?){1,10})/i
      )
      if (schoolSection) {
        const lines = schoolSection[1].split("\n")
          .map(l => l.trim())
          .filter(l => l.length > 3 && /school|elementary|middle|high|district/i.test(l))
        if (lines.length > 0) {
          schools = lines.slice(0, 5).join("; ")
        }
      }

      // Also look for school names in table/list format
      if (!schools) {
        const schoolEls = Array.from(
          document.querySelectorAll("[class*='school'], [data-school], [id*='school']")
        )
        const schoolNames = schoolEls
          .map(el => (el.innerText || "").trim())
          .filter(t => t.length > 3)
        if (schoolNames.length > 0) schools = schoolNames.slice(0, 5).join("; ")
      }

      // -------------------------------------------------------
      // Price — confirm or update current price
      // -------------------------------------------------------
      const priceM = bodyText.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null

      // Beds/baths if needed
      const bedsM = bodyText.match(/([\d]+)\s+Bedrooms?/i)
      const bathsM = bodyText.match(/([\d.]+)\s+Bathrooms?/i)
      const beds = bedsM ? parseFloat(bedsM[1]) : null
      const baths = bathsM ? parseFloat(bathsM[1]) : null

      return {
        hoaFees,
        floors,
        sqft,
        garages,
        moveInDate,
        statusLabel,
        schools,
        price,
        beds,
        baths,
      }
    })

    console.log(
      `    HOA=$${data.hoaFees} | floors=${data.floors} | sqft=${data.sqft} | ` +
      `garages=${data.garages} | move-in=${data.moveInDate} | status=${data.statusLabel} | ` +
      `schools=${data.schools ? data.schools.slice(0, 60) + "..." : "none"}`
    )
    return data
  } catch (err) {
    console.warn(`  Warning: Failed to scrape ${url}: ${err.message}`)
    return null
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Melia Homes — Scrape Detail Pages")
  console.log("=".repeat(60))

  // Fetch the target listings
  const listings = await prisma.listing.findMany({
    where: { id: { in: LISTING_IDS } },
    include: { community: { select: { name: true, city: true } } },
    orderBy: { id: "asc" },
  })

  if (listings.length === 0) {
    console.error("Error: None of the expected listing IDs found in DB")
    process.exit(1)
  }

  console.log(`\nFound ${listings.length} target listings:`)
  for (const l of listings) {
    console.log(
      `  [${l.id}] ${l.community.name} — ${l.address} | floors=${l.floors} HOA=$${l.hoaFees} schools=${l.schools ? "yes" : "null"} url=${l.sourceUrl?.slice(0, 80)}`
    )
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  let updated = 0
  const page = await context.newPage()

  try {
    for (const listing of listings) {
      console.log(`\n${"─".repeat(56)}`)
      console.log(`[${listing.id}] ${listing.community.name} — ${listing.address}`)

      if (!listing.sourceUrl) {
        console.log("  No sourceUrl — skipping")
        continue
      }

      const detail = await scrapeMeliaDetailPage(page, listing.sourceUrl)
      if (!detail) continue

      // Build update payload
      const updateData = {}

      if (detail.hoaFees && !listing.hoaFees) {
        updateData.hoaFees = detail.hoaFees
      }

      if (detail.floors && !listing.floors) {
        updateData.floors = detail.floors
      }

      // Fill sqft only if currently null
      if (detail.sqft && !listing.sqft) {
        updateData.sqft = detail.sqft
      }

      if (detail.garages && !listing.garages) {
        updateData.garages = detail.garages
      }

      if (detail.moveInDate && !listing.moveInDate) {
        updateData.moveInDate = detail.moveInDate
      }

      if (detail.schools && !listing.schools) {
        updateData.schools = detail.schools
      }

      // Recalculate pricePerSqft if missing
      const finalSqft = updateData.sqft || listing.sqft
      const finalPrice = listing.currentPrice
      if (finalPrice && finalSqft && !listing.pricePerSqft) {
        updateData.pricePerSqft = Math.round(finalPrice / finalSqft)
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.listing.update({ where: { id: listing.id }, data: updateData })
        console.log(`  Updated [${listing.id}]: ${JSON.stringify(updateData)}`)
        updated++
      } else {
        console.log(`  No new data to update for [${listing.id}]`)
      }

      await new Promise(r => setTimeout(r, 1500))
    }
  } finally {
    await page.close()
    await browser.close()
  }

  // -----------------------------------------------------------
  // Final summary
  // -----------------------------------------------------------
  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Listings processed: ${listings.length}`)
  console.log(`Updated: ${updated}`)

  console.log("\n[Final DB state — Melia active listings]")
  const finalListings = await prisma.listing.findMany({
    where: { id: { in: LISTING_IDS } },
    include: { community: { select: { name: true, city: true } } },
    orderBy: { id: "asc" },
    select: {
      id: true, address: true, floorPlan: true, floors: true, beds: true, baths: true,
      sqft: true, garages: true, currentPrice: true, pricePerSqft: true,
      hoaFees: true, moveInDate: true, schools: true, status: true, community: true,
    },
  })

  for (const l of finalListings) {
    console.log(`\n  [${l.id}] ${l.community.name} (${l.community.city})`)
    console.log(`       Address : ${l.address}`)
    console.log(`       Plan    : ${l.floorPlan || "—"}`)
    console.log(`       Specs   : ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | floors=${l.floors} | garages=${l.garages}`)
    console.log(`       Price   : $${l.currentPrice?.toLocaleString()} | pricePerSqft=$${l.pricePerSqft}`)
    console.log(`       HOA     : $${l.hoaFees || "—"}`)
    console.log(`       Move-in : ${l.moveInDate || "—"}`)
    console.log(`       Schools : ${l.schools || "—"}`)
    console.log(`       Status  : ${l.status}`)
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
