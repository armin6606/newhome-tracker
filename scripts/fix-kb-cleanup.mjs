/**
 * Fix KB Home listing data after fresh scrape:
 * 1. Remove old stale listings (159-163) superseded by new scrape
 * 2. Clean garbled moveInDate values
 * 3. Fix community URLs to point to orange-county
 * 4. Scrape HOA + schools from individual KB listing pages
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

// Old listings that are superseded by the fresh scrape
const STALE_IDS = [159, 160, 161, 162, 163]

// Real OC communities and their correct KB URLs
const OC_COMMUNITY_URLS = {
  "Stafford Glen":                          "https://www.kbhome.com/new-homes-orange-county/stafford-glen",
  "Rhythm":                                 "https://www.kbhome.com/new-homes-orange-county/rhythm",
  "Palm Court":                             "https://www.kbhome.com/new-homes-orange-county/palm-court",
  "Sunflower":                              "https://www.kbhome.com/new-homes-orange-county/sunflower",
  "Fresco in the Reserve at Orchard Hills": "https://www.kbhome.com/new-homes-orange-county/fresco-in-the-reserve-at-orchard-hills",
  "Moonlight at Luna Park":                 "https://www.kbhome.com/new-homes-orange-county/moonlight-at-luna-park",
}

async function scrapeListingDetails(page, listingUrl) {
  try {
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 25000 })
    await page.waitForTimeout(2500)

    return await page.evaluate(() => {
      const text = document.body.innerText

      // HOA
      let hoa = null
      const hoaMatch = text.match(/HOA[^$\n]*\$\s*([\d,]+)/i)
        || text.match(/Association Fee[^$\n]*\$\s*([\d,]+)/i)
        || text.match(/\$\s*([\d,]+)\s*\/\s*month.*HOA/i)
      if (hoaMatch) {
        const val = parseInt(hoaMatch[1].replace(/,/g, ""), 10)
        if (val > 0 && val < 5000) hoa = val
      }

      // Schools — look for school names in nearby schools section
      const schoolSection = document.querySelector('[class*="school"], [id*="school"], [class*="School"]')
      let schools = null
      if (schoolSection) {
        const names = [...schoolSection.querySelectorAll("li, p, span")]
          .map(el => el.textContent?.trim())
          .filter(t => t && /\b(elementary|middle|junior high|high school|academy|prep)\b/i.test(t))
        if (names.length) schools = names.join(", ")
      }

      // Tax rate
      let taxRate = null
      const taxMatch = text.match(/tax rate[:\s]*([\d.]+)%/i)
        || text.match(/([\d.]+)%\s*tax/i)
      if (taxMatch) taxRate = parseFloat(taxMatch[1])

      return { hoa, schools, taxRate }
    })
  } catch {
    return {}
  }
}

async function main() {
  // 1. Mark stale old listings as removed
  console.log("── Marking stale old listings as removed ──")
  for (const id of STALE_IDS) {
    const l = await prisma.listing.findUnique({ where: { id } })
    if (l) {
      await prisma.listing.update({ where: { id }, data: { status: "removed", soldAt: new Date() } })
      console.log(`  ✓ [${id}] ${l.address} → removed`)
    }
  }

  // 2. Clean garbled moveInDate values
  console.log("\n── Cleaning garbled moveInDate ──")
  const listings = await prisma.listing.findMany({
    where: { community: { builder: { name: "KB Home" } }, status: "active" }
  })
  for (const l of listings) {
    if (!l.moveInDate) continue
    // Clean: remove everything after newline, trim
    const cleaned = l.moveInDate.split("\n")[0].trim()
    // Normalize "Now" → "Move-In Ready"
    const final = /^now$/i.test(cleaned) ? "Move-In Ready" : cleaned
    if (final !== l.moveInDate) {
      await prisma.listing.update({ where: { id: l.id }, data: { moveInDate: final } })
      console.log(`  ✓ [${l.id}] "${l.moveInDate}" → "${final}"`)
    }
  }

  // 3. Fix community URLs
  console.log("\n── Fixing community URLs and cities ──")
  for (const [name, url] of Object.entries(OC_COMMUNITY_URLS)) {
    const c = await prisma.community.findFirst({
      where: { name, builder: { name: "KB Home" } }
    })
    if (c) {
      const updates = { url }
      if (c.city === "Orange County") {
        // Try to infer city from URL
        const citySlug = url.match(/orange-county\/[^/]+$/)?.[0]
        // Will fix city via scraping below
      }
      await prisma.community.update({ where: { id: c.id }, data: updates })
      console.log(`  ✓ ${name} URL updated`)
    }
  }

  // 4. Fix cities for communities still showing "Orange County"
  console.log("\n── Fixing community cities ──")
  const CITY_MAP = {
    "Stafford Glen":                          "Tustin",
    "Rhythm":                                 "Long Beach",
    "Palm Court":                             "Anaheim",
    "Sunflower":                              "Anaheim",
    "Fresco in the Reserve at Orchard Hills": "Irvine",
    "Moonlight at Luna Park":                 "Irvine",
  }
  for (const [name, city] of Object.entries(CITY_MAP)) {
    const result = await prisma.community.updateMany({
      where: { name, builder: { name: "KB Home" } },
      data: { city }
    })
    if (result.count) console.log(`  ✓ ${name} → ${city}`)
  }

  // 5. Scrape HOA from individual listing pages (KB listing detail URLs)
  console.log("\n── Scraping HOA from KB listing pages ──")
  const activeListings = await prisma.listing.findMany({
    where: {
      community: { builder: { name: "KB Home" } },
      status: "active",
      hoaFees: null,
      sourceUrl: { not: null }
    },
    select: { id: true, address: true, sourceUrl: true }
  })
  console.log(`  Found ${activeListings.length} active KB listings to check for HOA`)

  if (activeListings.length > 0) {
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    })
    const page = await context.newPage()

    for (const l of activeListings) {
      const details = await scrapeListingDetails(page, l.sourceUrl)
      if (details.hoa || details.schools || details.taxRate) {
        const updates = {}
        if (details.hoa) updates.hoaFees = details.hoa
        if (details.schools) updates.schools = details.schools
        if (details.taxRate && details.taxRate > 0) {
          // Will need price to compute annual tax — skip for now, just log
        }
        if (Object.keys(updates).length) {
          await prisma.listing.update({ where: { id: l.id }, data: updates })
          console.log(`  ✓ [${l.id}] ${l.address} → ${JSON.stringify(updates)}`)
        }
      } else {
        console.log(`  - [${l.id}] ${l.address} no extra data found`)
      }
      await page.waitForTimeout(800)
    }

    await browser.close()
  }

  // Final summary
  const final = await prisma.listing.findMany({
    where: { community: { builder: { name: "KB Home" } }, status: "active" },
    include: { community: true },
    orderBy: { community: { name: "asc" } }
  })
  console.log(`\n── Final active KB Home listings: ${final.length} ──`)
  final.forEach(l => {
    console.log(`  [${l.id}] ${l.address} | ${l.community.name}, ${l.community.city} | $${l.currentPrice?.toLocaleString()} | ${l.beds}bd ${l.baths}ba ${l.sqft}sqft ${l.floors}fl | hoa:${l.hoaFees} moveIn:${l.moveInDate}`)
  })

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
