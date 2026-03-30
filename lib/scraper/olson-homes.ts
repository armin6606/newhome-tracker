/**
 * Olson Homes scraper.
 * WordPress with custom map sidebar. Communities listed at /find-new-homes-near-me/.
 * OC communities: Madera Walk (Cypress), Tierra Walk (Cypress), and others.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const INDEX_URL = "https://www.olsonhomes.com/find-new-homes-near-me/"
const BASE_URL = "https://www.olsonhomes.com"

const OC_CITIES = ["cypress", "anaheim", "irvine", "orange", "fullerton", "garden grove", "huntington beach", "westminster", "stanton", "fountain valley", "buena park", "la palma", "seal beach", "los alamitos", "santa ana", "tustin", "newport", "yorba linda", "brea", "la habra", "placentia", "laguna"]

export async function scrapeOlsonHomesOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Olson Homes index page...")
    await page.goto(INDEX_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)

    // Get all community links from sidebar or dynamic list
    const communityLinks = await page.evaluate((ocCities) => {
      const results: { name: string; url: string; city: string }[] = []
      const seen = new Set<string>()

      // Check .dynamic-communities-list and .map-side-bar
      const selectors = [".dynamic-communities-list a", ".map-side-bar .map-btn", ".map-side-bar-menu .menu-item a", "a[href*='/community/'], a[href^='/'][href*='walk'], a[href^='/'][href*='homes']"]
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((a) => {
          const href = (a as HTMLAnchorElement).href
          if (!href || seen.has(href) || href.includes("#") || href.includes("javascript")) return
          seen.add(href)

          const card = a.closest(".menu-item, li, article") || a
          const text = (card as HTMLElement).innerText?.toLowerCase() || (a as HTMLElement).innerText?.toLowerCase() || ""
          const isOC = ocCities.some((c: string) => text.includes(c))
          if (!isOC) return

          const nameEl = (card as HTMLElement).querySelector(".menu-txt-inner, h2, h3, h4") as HTMLElement | null
          const name = nameEl?.innerText?.split("\n")[0]?.trim() || (a as HTMLElement).innerText?.split("\n")[0]?.trim() || ""
          if (!name || name.length > 60) return

          const cityM = text.match(/([a-z\s]+),\s*ca/i)
          results.push({ name, url: href, city: cityM?.[1]?.trim() || "" })
        })
        if (results.length > 0) break
      }

      return results
    }, OC_CITIES)

    console.log(`Found ${communityLinks.length} Olson OC communities`)

    for (const comm of communityLinks) {
      console.log(`  Scraping Olson: ${comm.name}`)
      try {
        const fullUrl = comm.url.startsWith("http") ? comm.url : `${BASE_URL}${comm.url}`
        await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(3000)

        const data = await page.evaluate((url) => {
          const body = (document.body as HTMLElement).innerText || ""

          const priceM = body.match(/(?:from|starting|priced from)\s*\$\s*([\d,]+)/i) || body.match(/\$\s*([\d,]+(?:,\d{3})*)/)
          const bedM = body.match(/(\d+)\s*Bedrooms?\s*\/\s*Up to\s*(\d+)/i) || body.match(/(\d+)\s*[-–]\s*(\d+)\s*Bed/i) || body.match(/(\d+)\s*Bed/i)
          const bathM = body.match(/Up to\s*([\d.]+)\s*Bath/i) || body.match(/([\d.]+)\s*Bath/i)
          const sqftM = body.match(/(?:approx\.?|approximately)?\s*([\d,]+)\s*[-–]\s*([\d,]+)\s*(?:SF|sq\.?\s*ft)/i) || body.match(/([\d,]+)\s*(?:SF|sq\.?\s*ft)/i)
          const addrEl = document.querySelector(".footer-community-address, [class*='address']") as HTMLElement | null
          const typeM = body.match(/(townhome|townhouse|condo|single.family|flat)/i)
          const cityM = body.match(/(?:in|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)

          // Check for incentive text on the community page
          let incentives: string | undefined
          const incentiveSelectors = [
            '[class*="incentive"]', '[class*="Incentive"]',
            '[class*="promotion"]', '[class*="Promotion"]',
            '[class*="offer"]', '[class*="Offer"]',
            '[class*="special"]', '[class*="Special"]',
            '[class*="closing"]', '[class*="buydown"]',
            '[class*="credit"]', '[class*="Credit"]',
            '[class*="savings"]', '[class*="Savings"]',
          ]
          for (const sel of incentiveSelectors) {
            const el = document.querySelector(sel) as HTMLElement | null
            const txt = el?.innerText?.trim()
            if (txt && txt.length > 5 && txt.length < 500) { incentives = txt; break }
          }

          // Regex fallback on page text
          if (!incentives) {
            const incPatterns = [
              /(?:closing\s+cost\s+(?:credit|assistance)|rate\s+buy[-\s]?down|flex\s+cash|design\s+(?:credit|dollars?)|upgrade\s+credit|builder\s+incentive|special\s+offer|limited[-\s]time\s+offer)\s*[:\-–]?\s*([^\n.]{5,120})/gi,
            ]
            const matches: string[] = []
            for (const pat of incPatterns) {
              let m: RegExpExecArray | null
              while ((m = pat.exec(body)) !== null) {
                matches.push(m[0].trim())
                if (matches.length >= 3) break
              }
            }
            if (matches.length) incentives = matches.join(" | ")
          }

          return {
            price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
            beds: bedM ? parseFloat(bedM[1]) : undefined,
            baths: bathM ? parseFloat(bathM[1]) : undefined,
            sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
            address: addrEl?.innerText?.trim() || "",
            propertyType: typeM?.[1] || "Attached",
            city: cityM?.[1] || "",
            incentives,
            sourceUrl: url,
          }
        }, fullUrl)

        const price = data.price && data.price > 100000 ? data.price : undefined
        allListings.push({
          communityName: comm.name,
          communityUrl: fullUrl,
          address: data.address || `${comm.name} - Plans Available`,
          sqft: data.sqft,
          beds: data.beds,
          baths: data.baths,
          price,
          pricePerSqft: price && data.sqft ? Math.round(price / data.sqft) : undefined,
          propertyType: data.propertyType || "Attached",
          incentives: data.incentives,
          sourceUrl: fullUrl,
        })
      } catch (err) {
        console.log(`  Error scraping Olson ${comm.name}:`, err)
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}
