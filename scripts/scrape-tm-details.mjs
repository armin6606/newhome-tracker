/**
 * Taylor Morrison — Scrape floor counts for active OC listings
 *
 * Current TM OC listings have floorPlan set ("Plan 1", "Plan 2", "Plan 3")
 * but floors=null. This script visits each community's floor plans page (or
 * each listing's sourceUrl) to extract the number of stories per plan.
 *
 * Strategy:
 *   1. Visit each community's /floor-plans page to extract per-plan stories
 *   2. Match stories to listings by floorPlan name
 *   3. Also fill any missing HOA, sqft, moveInDate from listing sourceUrl
 *
 * Run: node --env-file=.env.local scripts/scrape-tm-details.mjs
 */

import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const TM_BUILDER_ID = 8
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
// Scrape floor plan data from a TM community /floor-plans page
// Returns: Map of planName → { floors, sqft, beds, baths }
// -----------------------------------------------------------
async function scrapeCommunityFloorPlans(page, communityUrl) {
  const floorPlansUrl = communityUrl + "/floor-plans"
  console.log(`\n  Scraping floor plans: ${floorPlansUrl}`)

  const planMap = new Map()

  try {
    await page.goto(floorPlansUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Scroll to load all plan cards
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await page.waitForTimeout(600)
    }
    await page.waitForTimeout(1500)

    // Extract plan data from the embedded JSON (TM embeds data in <script> tags)
    const scriptData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script"))
      for (const s of scripts) {
        const t = s.textContent || ""
        // TM floor plan pages sometimes embed floorPlanList
        if (t.includes("floorPlanList") || t.includes("floorPlans")) {
          try {
            const data = JSON.parse(t)
            const plans = data.floorPlanList?.plans ||
              data.floorPlans ||
              data.plans ||
              null
            if (plans && Array.isArray(plans)) {
              return plans.map(p => ({
                name: p.name || p.floorPlan || p.planName || null,
                stories: p.stories || p.floors || p.numStories || null,
                sqft: p.sqft || p.squareFeet || null,
                beds: p.bed || p.beds || null,
                baths: p.totalBath || p.baths || null,
              }))
            }
          } catch (e) {}
        }
      }
      return null
    })

    if (scriptData && scriptData.length > 0) {
      console.log(`    Found ${scriptData.length} plans in embedded JSON`)
      for (const p of scriptData) {
        if (p.name) {
          planMap.set(p.name.toLowerCase(), p)
          console.log(`      Plan "${p.name}": stories=${p.stories}, sqft=${p.sqft}`)
        }
      }
      return planMap
    }

    // Fallback: parse the DOM for plan cards
    const domPlans = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""
      const plans = []

      // Find all headings that look like plan names
      const headings = Array.from(document.querySelectorAll("h2, h3, h4, [class*='plan-name'], [class*='planName']"))
      for (const h of headings) {
        const t = (h.innerText || "").trim()
        if (!/^Plan\s+\d/.test(t) && !/^Plan\s+[A-Z]/i.test(t)) continue

        // Look for stories near this heading by walking the parent tree
        let parent = h.parentElement
        let storiesText = null
        let sqftText = null
        let bedsText = null
        for (let depth = 0; depth < 6 && parent; depth++) {
          const text = parent.innerText || ""
          if (!storiesText) {
            const m = text.match(/([\d]+)\s*(?:stories|story|floors?)/i)
            if (m) storiesText = m[1]
          }
          if (!sqftText) {
            const m = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i)
            if (m) sqftText = m[1].replace(/,/g, "")
          }
          if (!bedsText) {
            const m = text.match(/([\d]+)\s*(?:beds?|bedrooms?)/i)
            if (m) bedsText = m[1]
          }
          if (storiesText && sqftText) break
          parent = parent.parentElement
        }

        plans.push({ name: t, stories: storiesText, sqft: sqftText, beds: bedsText })
      }
      return plans
    })

    if (domPlans.length > 0) {
      console.log(`    Found ${domPlans.length} plans via DOM parsing`)
      for (const p of domPlans) {
        planMap.set(p.name.toLowerCase(), p)
        console.log(`      Plan "${p.name}": stories=${p.stories}, sqft=${p.sqft}`)
      }
    } else {
      // Last resort: search body text for "Plan N ... X stories"
      const textPlans = await page.evaluate(() => {
        const text = document.body?.innerText || ""
        const results = []
        // Match patterns like "Plan 1\n...2 Stories" or "Plan 1 | 2 Stories"
        const re = /(Plan\s+\d+[^\n]*)\n(?:[^\n]*\n){0,5}[^\n]*([\d]+)\s*(?:stories|story)/gi
        let m
        while ((m = re.exec(text)) !== null) {
          results.push({ name: m[1].trim(), stories: m[2] })
        }
        return results
      })
      for (const p of textPlans) {
        if (!planMap.has(p.name.toLowerCase())) {
          planMap.set(p.name.toLowerCase(), p)
          console.log(`      Plan "${p.name}": stories=${p.stories} (text parse)`)
        }
      }
    }

    if (planMap.size === 0) {
      console.log(`    Warning: no plans found on ${floorPlansUrl}`)
    }
  } catch (err) {
    console.warn(`    Warning: Failed to scrape ${floorPlansUrl}: ${err.message}`)
  }

  return planMap
}

// -----------------------------------------------------------
// Scrape an individual TM listing page for extra details
// -----------------------------------------------------------
async function scrapeTmListingPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Try to get the embedded JSON data
    const data = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""

      // Look for the JSON script with homeDetails or similar
      const scripts = Array.from(document.querySelectorAll("script"))
      for (const s of scripts) {
        const t = s.textContent || ""
        if (t.includes("availableHomesList") || t.includes("homeDetails") || t.includes("stories")) {
          try {
            const parsed = JSON.parse(t)
            // TM embeds home data on individual home pages too
            const home = parsed.homeDetails || parsed.home || null
            if (home) {
              return {
                stories: home.stories || home.floors || null,
                hoaDues: home.hoaDues || null,
                sqft: home.sqft || null,
                readyDate: home.readyDate || null,
                beds: home.bed || null,
                baths: home.totalBath || null,
              }
            }
          } catch (e) {}
        }
      }

      // Fallback: text parsing
      const storiesM = bodyText.match(/(\d+)\s*(?:STORIES|STORY|FLOORS?)\b/i)
      const hoaM = bodyText.match(/HOA[^$\n]*\$\s*([\d,]+)/i)
      const readyM = bodyText.match(/(?:READY|MOVE.IN|AVAILABLE)\s*(?:DATE[:\s]+)?([A-Za-z]+\s+\d{4}|\d{1,2}\/\d{4})/i)

      return {
        stories: storiesM ? storiesM[1] : null,
        hoaDues: hoaM ? parseInt(hoaM[1].replace(/,/g, ""), 10) : null,
        readyDate: readyM ? readyM[1] : null,
        sqft: null,
        beds: null,
        baths: null,
      }
    })
    return data
  } catch (err) {
    console.warn(`  Warning scraping ${url}: ${err.message}`)
    return null
  }
}

// -----------------------------------------------------------
// Main
// -----------------------------------------------------------
async function main() {
  console.log("=".repeat(60))
  console.log("Taylor Morrison — Scrape Floor Counts & Details")
  console.log("=".repeat(60))

  // Get all active TM listings missing floors, grouped by community
  const allListings = await prisma.listing.findMany({
    where: {
      community: { builderId: TM_BUILDER_ID },
      status: { not: "removed" },
    },
    include: { community: { select: { id: true, name: true, city: true, url: true } } },
    orderBy: [{ communityId: "asc" }, { id: "asc" }],
  })

  const missingFloors = allListings.filter(l => l.floors === null)
  console.log(`\nTotal active TM listings: ${allListings.length}`)
  console.log(`Missing floors: ${missingFloors.length}`)

  if (missingFloors.length === 0) {
    console.log("All listings already have floor data. Nothing to do.")
    await prisma.$disconnect()
    return
  }

  // Group by community
  const byComm = new Map()
  for (const l of missingFloors) {
    const cid = l.community.id
    if (!byComm.has(cid)) byComm.set(cid, { community: l.community, listings: [] })
    byComm.get(cid).listings.push(l)
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
    for (const [cid, { community, listings }] of byComm.entries()) {
      console.log(`\n${"─".repeat(56)}`)
      console.log(`Community [${cid}]: ${community.name} (${community.city})`)
      console.log(`URL: ${community.url}`)
      console.log(`Listings needing floors: ${listings.length}`)

      // Step A: Scrape floor plans page to get per-plan story counts
      const planMap = await scrapeCommunityFloorPlans(page, community.url)

      // Step B: For each listing, find its floor count
      for (const listing of listings) {
        console.log(`\n  Listing [${listing.id}] ${listing.address} | floorPlan="${listing.floorPlan}"`)

        let floors = null
        let hoaFees = listing.hoaFees
        let moveInDate = listing.moveInDate

        // Try to match from plan map
        if (listing.floorPlan && planMap.size > 0) {
          // Try exact match first
          const key = listing.floorPlan.toLowerCase()
          let planData = planMap.get(key)

          // Try "Plan 1" matching "Plan 1 | 2,081 sq ft" etc.
          if (!planData) {
            for (const [k, v] of planMap.entries()) {
              if (k.startsWith(key) || key.startsWith(k.split(" ").slice(0, 2).join(" ").toLowerCase())) {
                planData = v
                break
              }
            }
          }

          if (planData) {
            floors = planData.stories ? parseIntSafe(planData.stories) : null
            console.log(`    Matched plan "${listing.floorPlan}" → floors=${floors}`)
          }
        }

        // Step C: If still no floor count, visit the listing's sourceUrl
        if (floors === null && listing.sourceUrl) {
          console.log(`    Visiting sourceUrl for more details: ${listing.sourceUrl}`)
          const detail = await scrapeTmListingPage(page, listing.sourceUrl)
          if (detail) {
            floors = detail.stories ? parseIntSafe(detail.stories) : null
            if (!hoaFees && detail.hoaDues) hoaFees = detail.hoaDues
            if (!moveInDate && detail.readyDate) moveInDate = detail.readyDate
            console.log(`    From listing page: floors=${floors}, HOA=$${hoaFees}, ready=${moveInDate}`)
          }
          await new Promise(r => setTimeout(r, 1000))
        }

        // Build update
        const updateData = {}
        if (floors !== null && listing.floors === null) updateData.floors = floors
        if (hoaFees && !listing.hoaFees) updateData.hoaFees = hoaFees
        if (moveInDate && !listing.moveInDate) updateData.moveInDate = moveInDate

        // Fix pricePerSqft if missing
        if (!listing.pricePerSqft && listing.currentPrice && listing.sqft) {
          updateData.pricePerSqft = Math.round(listing.currentPrice / listing.sqft)
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.listing.update({ where: { id: listing.id }, data: updateData })
          console.log(`    Updated [${listing.id}]: ${JSON.stringify(updateData)}`)
          updated++
        } else {
          console.log(`    No new data found for [${listing.id}]`)
        }
      }

      await new Promise(r => setTimeout(r, 1000))
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
  console.log(`Listings processed: ${missingFloors.length}`)
  console.log(`Updated: ${updated}`)

  console.log("\n[Final DB state — active TM OC listings]")
  const finalListings = await prisma.listing.findMany({
    where: {
      community: { builderId: TM_BUILDER_ID },
      status: { not: "removed" },
    },
    include: { community: { select: { name: true, city: true } } },
    orderBy: [{ communityId: "asc" }, { currentPrice: "asc" }],
  })

  let lastComm = null
  for (const l of finalListings) {
    if (l.community.name !== lastComm) {
      console.log(`\n  ${l.community.name} (${l.community.city}):`)
      lastComm = l.community.name
    }
    console.log(
      `    [${l.id}] ${l.status.toUpperCase()} | ${l.address} | ${l.floorPlan || "—"} | floors=${l.floors} | ` +
      `$${l.currentPrice?.toLocaleString()} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft | HOA=$${l.hoaFees} | ${l.moveInDate || "—"}`
    )
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  process.exit(1)
})
