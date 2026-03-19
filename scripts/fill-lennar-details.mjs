/**
 * Backfill garages, HOA, tax rate, and schools for all Lennar listings.
 * - Community schools come from Lennar community pages (already confirmed).
 * - Garages/HOA/tax are scraped from property-details for valid listings.
 * - Pineridge - Hazel garages are inferred (2, confirmed from live page).
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

// ── Known school data per community (from manual page inspection) ──────────
const COMMUNITY_SCHOOLS = {
  "Pineridge - Hazel": "Sunny Hills High School, D. Russell Parks Junior High School, Laguna Road Elementary School",
  "Pineridge - Torrey": "Sunny Hills High School, D. Russell Parks Junior High School, Laguna Road Elementary School",
  "Nova - Active Adult": "Tesoro High School, Esencia Middle School",
  "Strata - Active Adult": "Tesoro High School, Esencia Middle School",
  "Cielo Vista": "Yorba Linda High School",
}

// ── Extract data from a /property-details page ────────────────────────────
async function scrapePropertyDetails(page, sourceUrl) {
  const pdUrl = sourceUrl.endsWith("/property-details")
    ? sourceUrl
    : `${sourceUrl}/property-details`

  try {
    await page.goto(pdUrl, { waitUntil: "domcontentloaded", timeout: 25000 })
    await page.waitForFunction(
      () => document.body.innerText.includes("Parking") || document.body.innerText.includes("Tax rate"),
      { timeout: 12000 }
    ).catch(() => {})

    return await page.evaluate(() => {
      const kv = {}
      document.querySelectorAll("div, li").forEach(el => {
        const ch = el.children
        if (ch.length !== 2) return
        const k = ch[0].innerText?.trim()
        const v = ch[1].innerText?.trim()
        if (k && v && k.length < 80 && !k.includes("\n") && !kv[k]) kv[k] = v
      })

      // Garages from Parking field
      let garages
      const parkingRaw = kv["Parking"]
      if (parkingRaw) {
        const m = parkingRaw.match(/(\d+)/)
        if (m) garages = parseInt(m[1], 10)
      }

      // HOA / Special assessment
      let hoaFees
      const hoaRaw = kv["Special assessment fee"] || kv["HOA fee"] || kv["Association fee"] || kv["HOA"]
      if (hoaRaw) {
        const m = hoaRaw.match(/\$?([\d,]+(?:\.\d+)?)/)
        if (m) hoaFees = Math.round(parseFloat(m[1].replace(/,/g, "")))
      }

      // Tax rate
      let taxRate
      const taxRaw = kv["Tax rate"]
      if (taxRaw) {
        const m = taxRaw.match(/([\d.]+)/)
        if (m) taxRate = parseFloat(m[1])
      }

      return { garages, hoaFees, taxRate }
    })
  } catch {
    return {}
  }
}

async function main() {
  // ── Step 1: Bulk-update schools for all communities where we know them ──
  console.log("── Updating schools by community ──")
  for (const [communityName, schools] of Object.entries(COMMUNITY_SCHOOLS)) {
    const result = await prisma.listing.updateMany({
      where: {
        community: { name: communityName, builder: { name: "Lennar" } },
        schools: null,
      },
      data: { schools },
    })
    console.log(`  ${communityName}: ${result.count} listings → schools set`)
  }

  // ── Step 2: Pineridge - Hazel bulk garages=2 ───────────────────────────
  console.log("\n── Setting Pineridge - Hazel garages=2 ──")
  const hazelGarage = await prisma.listing.updateMany({
    where: {
      garages: null,
      community: { name: "Pineridge - Hazel", builder: { name: "Lennar" } },
    },
    data: { garages: 2 },
  })
  console.log(`  Updated ${hazelGarage.count} listings`)

  // ── Step 3: Scrape property-details for Nova, Strata, Cielo Vista ───────
  const communitiesToScrape = ["Nova - Active Adult", "Strata - Active Adult", "Cielo Vista"]
  const listings = await prisma.listing.findMany({
    where: {
      status: "active",
      community: { name: { in: communitiesToScrape }, builder: { name: "Lennar" } },
      sourceUrl: { not: null },
      OR: [{ garages: null }, { hoaFees: null }],
    },
    select: { id: true, address: true, sourceUrl: true, currentPrice: true,
      community: { select: { name: true } } },
  })

  console.log(`\n── Scraping property-details for ${listings.length} listings ──`)
  if (!listings.length) { await prisma.$disconnect(); return }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()
  let scraped = 0

  for (const l of listings) {
    const pd = await scrapePropertyDetails(page, l.sourceUrl)
    const updateData = {}
    if (pd.garages != null) updateData.garages = pd.garages
    if (pd.hoaFees != null) updateData.hoaFees = pd.hoaFees
    if (pd.taxRate != null && l.currentPrice) {
      updateData.taxes = Math.round(l.currentPrice * pd.taxRate / 100)
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.listing.update({ where: { id: l.id }, data: updateData })
      console.log(`  ✓ [${l.id}] ${l.address} → ${JSON.stringify(updateData)}`)
      scraped++
    } else {
      console.log(`  ✗ [${l.id}] ${l.address} (${l.community.name}) — nothing found`)
    }
    await page.waitForTimeout(400)
  }

  await browser.close()
  console.log(`\nScraped ${scraped}/${listings.length} listings.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
