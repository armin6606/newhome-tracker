/**
 * Scrape GreatSchools.org ratings for all unique school names in the DB.
 * Caches results in the SchoolRating table.
 * Uses simple fetch + HTML parsing (no Playwright needed for GreatSchools search).
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

async function scrapeRating(page, schoolName, state) {
  const searchUrl = `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(schoolName)}&state=${encodeURIComponent(state)}&gradeLevels=e,m,h`
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
    await page.waitForTimeout(2000)

    return await page.evaluate((name) => {
      // Find school results
      const results = document.querySelectorAll("[class*='school-card'], [class*='SchoolCard'], [data-gs-content='school-card'], .search-result, [class*='search-result']")

      // Try to find the best matching result
      for (const card of results) {
        const cardText = card.innerText || ""
        const nameMatch = cardText.toLowerCase().includes(name.toLowerCase().split(" ").slice(0, 3).join(" "))
        if (!nameMatch) continue

        // Look for rating
        const ratingEl = card.querySelector("[class*='rating'], [class*='Rating'], [data-testid*='rating'], .circle-rating, [class*='circle']")
        if (ratingEl) {
          const ratingText = ratingEl.innerText?.trim()
          const m = ratingText?.match(/^(\d+)/)
          if (m) {
            const url = card.querySelector("a")?.href || null
            return { rating: parseInt(m[1], 10), url }
          }
        }
      }

      // Fallback: look for any rating number near the school name in text
      const allText = document.body.innerText
      const lines = allText.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(name.toLowerCase().split(" ")[0].toLowerCase())) {
          // Look in nearby lines for a rating (1-10)
          for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
            const m = lines[j].match(/^\s*(\d+)\s*\/\s*10\s*$/)
            if (m) return { rating: parseInt(m[1], 10), url: null }
          }
        }
      }

      // Try to find any school link + rating circle
      const schoolLinks = document.querySelectorAll("a[href*='/california/']")
      for (const link of schoolLinks) {
        const parent = link.closest("[class*='card'], [class*='result'], li, article") || link.parentElement
        if (!parent) continue
        const text = parent.innerText?.toLowerCase() || ""
        if (!text.includes(name.toLowerCase().split(" ")[0].toLowerCase())) continue
        const ratingEl = parent.querySelector("[class*='rating'], [class*='circle'], [data-testid='circle-rating']")
        const ratingText = ratingEl?.innerText?.trim()
        const m = ratingText?.match(/^(\d+)/)
        if (m) return { rating: parseInt(m[1], 10), url: link.href }
      }

      return null
    }, schoolName)
  } catch (err) {
    console.log(`  Error for "${schoolName}": ${err.message?.slice(0, 60)}`)
    return null
  }
}

async function main() {
  // Get all unique school names from DB
  const listings = await prisma.listing.findMany({
    where: { schools: { not: null } },
    select: { schools: true, community: { select: { state: true } } },
  })

  const schoolSet = new Map() // name -> state
  for (const l of listings) {
    const state = l.community.state || "CA"
    l.schools.split(/[,\n]/).map(s => s.trim()).filter(Boolean).forEach(name => {
      if (!schoolSet.has(name)) schoolSet.set(name, state)
    })
  }

  console.log(`Found ${schoolSet.size} unique schools to look up`)

  // Check which ones we already have cached
  const existing = await prisma.schoolRating.findMany({ select: { name: true } })
  const existingNames = new Set(existing.map(r => r.name))
  const toScrape = [...schoolSet.entries()].filter(([name]) => !existingNames.has(name))
  console.log(`Already cached: ${existingNames.size}, need to scrape: ${toScrape.length}`)

  if (!toScrape.length) {
    console.log("All schools already cached.")
    await prisma.$disconnect()
    return
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  let found = 0
  for (const [name, state] of toScrape) {
    console.log(`  Searching: "${name}"`)
    const result = await scrapeRating(page, name, state)
    if (result?.rating) {
      await prisma.schoolRating.upsert({
        where: { name },
        create: { name, state, rating: result.rating, gsUrl: result.url },
        update: { rating: result.rating, gsUrl: result.url, cachedAt: new Date() },
      })
      console.log(`    ✓ Rating: ${result.rating}/10`)
      found++
    } else {
      // Store null so we don't re-scrape endlessly
      await prisma.schoolRating.upsert({
        where: { name },
        create: { name, state, rating: null, gsUrl: null },
        update: { cachedAt: new Date() },
      })
      console.log(`    ✗ Not found`)
    }
    await page.waitForTimeout(800)
  }

  await browser.close()
  console.log(`\nFound ratings for ${found}/${toScrape.length} schools.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
