/**
 * KB Home — Scrape floor plan details for active OC listings
 *
 * All active KB listings currently have floorPlan=null.
 * This script visits each listing's sourceUrl to extract:
 *   - Plan name/number (e.g. "Plan 1643 Modeled" → stored as "1643")
 *   - Floor count (stories)
 *   - HOA fees
 *   - Move-in date
 *   - sqft (if missing)
 *
 * Run: node --env-file=.env.local scripts/scrape-kb-details.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const KB_BUILDER_ID = 3
const BASE_URL = "https://www.kbhome.com"
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

// Extract just the number from plan name: "Plan 1643 Modeled" → "1643"
function extractPlanNumber(planStr) {
  if (!planStr) return null
  const m = planStr.match(/Plan\s+([\d]+)/i)
  return m ? m[1] : planStr.trim()
}

// -----------------------------------------------------------
// Scrape one KB MIR detail page
// -----------------------------------------------------------
async function scrapeKbDetailPage(page, url) {
  console.log(`  Visiting: ${url}`)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    // Scroll to trigger lazy loads
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await page.waitForTimeout(700)
    }

    const detail = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""

      // Helper: extract metric using the "VALUE\nLABEL" format KB uses
      const getMetricByLabel = (label) => {
        const re = new RegExp(`([\\d.,]+)\\s*\\n\\s*${label}`, "i")
        const m = bodyText.match(re)
        if (m) return m[1].replace(/,/g, "")
        // fallback: same line
        const re2 = new RegExp(`([\\d.,]+)\\s+${label}`, "i")
        const m2 = bodyText.match(re2)
        return m2 ? m2[1].replace(/,/g, "") : null
      }

      // Plan name — KB uses "Plan NNNN" or "Plan NNNN Modeled"
      // Look in h1, h2, or the structured data on the page
      let planName = null
      // Try structured data first
      const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"))
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent)
          // Could be @graph array
          const items = Array.isArray(data["@graph"]) ? data["@graph"] : [data]
          for (const item of items) {
            const name = item.name || item.floorPlan || ""
            if (/Plan\s+\d/i.test(name)) {
              planName = name
              break
            }
          }
        } catch (e) {}
        if (planName) break
      }

      // Fallback: find heading text matching "Plan NNNN"
      if (!planName) {
        const headings = Array.from(document.querySelectorAll("h1, h2, h3, [class*='plan'], [class*='title']"))
        for (const el of headings) {
          const t = (el.innerText || "").trim()
          if (/^Plan\s+\d/.test(t)) {
            planName = t
            break
          }
        }
      }

      // Fallback: scan body text
      if (!planName) {
        const m = bodyText.match(/(?:^|\n)(Plan\s+\d[\d\s\w]*?)(?:\n|$)/im)
        if (m) planName = m[1].trim()
      }

      // Stories
      const stories = getMetricByLabel("STORIES") || getMetricByLabel("STORY") || null

      // sqft
      const sqft = getMetricByLabel("SQFT") ||
        (bodyText.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i) || [])[1]?.replace(/,/g, "") ||
        null

      // Beds
      const beds = getMetricByLabel("BEDS") || getMetricByLabel("BED") || null

      // Baths
      const baths = getMetricByLabel("BATHS") || getMetricByLabel("BATH") || null

      // Garages
      const garages = getMetricByLabel("CARS") || getMetricByLabel("GARAGE") || null

      // HOA
      const hoaM = bodyText.match(/HOA[^$\n]*\$\s*([\d,]+)/i) ||
        bodyText.match(/Homeowners\s+Association[^$\n]*\$\s*([\d,]+)/i)
      const hoaFees = hoaM ? parseInt(hoaM[1].replace(/,/g, ""), 10) : null

      // Price
      const priceM = bodyText.match(/(?:Starting from|From|Price)[^\$\n]*\$\s*([\d,]+)/i) ||
        bodyText.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null

      // Move-in date
      const moveInM = bodyText.match(
        /(?:available|move.in|ready|estimated)[^\n]*?([A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i
      )
      const moveInDate = moveInM ? moveInM[1].trim() : null

      // Property type
      let propertyType = null
      if (/condominium|condo/i.test(bodyText)) propertyType = "Condo"
      else if (/townhome|townhouse/i.test(bodyText)) propertyType = "Townhome"
      else if (/single.family/i.test(bodyText)) propertyType = "Single Family"

      return {
        planName,
        stories,
        sqft,
        beds,
        baths,
        garages,
        hoaFees,
        price,
        moveInDate,
        propertyType,
      }
    })

    const planNumber = extractPlanNumber(detail.planName)
    console.log(
      `    Plan: "${detail.planName}" → stored as "${planNumber}" | ` +
      `floors=${detail.stories} | HOA=$${detail.hoaFees} | ` +
      `sqft=${detail.sqft} | move-in=${detail.moveInDate}`
    )

    return {
      planNumber,
      planNameRaw: detail.planName,
      floors: detail.stories ? parseIntSafe(detail.stories) : null,
      hoaFees: detail.hoaFees || null,
      sqft: detail.sqft ? parseIntSafe(detail.sqft) : null,
      beds: detail.beds ? parseFloatSafe(detail.beds) : null,
      baths: detail.baths ? parseFloatSafe(detail.baths) : null,
      garages: detail.garages ? parseIntSafe(detail.garages) : null,
      price: detail.price,
      moveInDate: detail.moveInDate,
      propertyType: detail.propertyType,
    }
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
  console.log("KB Home — Scrape Floor Plan Details")
  console.log("=".repeat(60))

  // Get all active KB listings that have a sourceUrl
  const listings = await prisma.listing.findMany({
    where: {
      community: { builderId: KB_BUILDER_ID },
      status: "active",
      sourceUrl: { not: null },
    },
    include: { community: { select: { name: true, city: true } } },
    orderBy: { id: "asc" },
  })

  console.log(`\nFound ${listings.length} active KB listings with sourceUrls`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  let updated = 0
  let failed = 0
  const results = []

  const page = await context.newPage()

  try {
    for (const listing of listings) {
      console.log(`\n[${listing.id}] ${listing.community.name} — ${listing.address}`)
      const url = listing.sourceUrl.startsWith("http")
        ? listing.sourceUrl
        : BASE_URL + listing.sourceUrl

      const detail = await scrapeKbDetailPage(page, url)
      if (!detail) {
        failed++
        results.push({ id: listing.id, address: listing.address, status: "failed" })
        continue
      }

      // Build update payload — only update fields where we got real data
      const updateData = {}

      if (detail.planNumber && !listing.floorPlan) {
        updateData.floorPlan = detail.planNumber
      }

      if (detail.floors && !listing.floors) {
        updateData.floors = detail.floors
      }

      if (detail.hoaFees && !listing.hoaFees) {
        updateData.hoaFees = detail.hoaFees
      }

      if (detail.moveInDate && !listing.moveInDate) {
        updateData.moveInDate = detail.moveInDate
      }

      // Fill sqft if missing
      if (detail.sqft && !listing.sqft) {
        updateData.sqft = detail.sqft
      }

      // Recalculate pricePerSqft if we now have both
      const finalSqft = updateData.sqft || listing.sqft
      const finalPrice = listing.currentPrice
      if (finalPrice && finalSqft && !listing.pricePerSqft) {
        updateData.pricePerSqft = Math.round(finalPrice / finalSqft)
      }

      if (detail.propertyType && !listing.propertyType) {
        updateData.propertyType = detail.propertyType
      }

      if (detail.garages && !listing.garages) {
        updateData.garages = detail.garages
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.listing.update({ where: { id: listing.id }, data: updateData })
        console.log(`    Updated listing [${listing.id}]: ${JSON.stringify(updateData)}`)
        updated++
        results.push({ id: listing.id, address: listing.address, status: "updated", changes: updateData })
      } else {
        console.log(`    No new data to update for listing [${listing.id}]`)
        results.push({ id: listing.id, address: listing.address, status: "no_change" })
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
  console.log(`Total listings processed: ${listings.length}`)
  console.log(`Updated: ${updated}`)
  console.log(`Failed: ${failed}`)
  console.log(`No change: ${listings.length - updated - failed}`)

  // Print final DB state for all active KB listings
  console.log("\n[Final DB state — active KB OC listings]")
  const finalListings = await prisma.listing.findMany({
    where: {
      community: { builderId: KB_BUILDER_ID },
      status: "active",
    },
    include: { community: { select: { name: true, city: true } } },
    orderBy: [{ communityId: "asc" }, { address: "asc" }],
  })

  let lastComm = null
  for (const l of finalListings) {
    if (l.community.name !== lastComm) {
      console.log(`\n  ${l.community.name} (${l.community.city}):`)
      lastComm = l.community.name
    }
    console.log(
      `    [${l.id}] ${l.address} | plan="${l.floorPlan}" | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | floors=${l.floors} | $${l.currentPrice?.toLocaleString()} | HOA=$${l.hoaFees} | ppSqft=$${l.pricePerSqft}`
    )
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
