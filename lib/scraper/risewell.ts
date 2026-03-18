/**
 * Risewell Homes scraper (formerly Landsea Homes / NWHM).
 * Both landseahomes.com and nwhm.com redirect to risewellhomes.com.
 * Uses the OC-specific page which filters via Algolia masterplan filter.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://risewellhomes.com/southern-california/orange-county-new-homes"

export async function scrapeRisewellOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Risewell Homes OC page...")
    await page.goto(OC_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(5000)

    // Scroll to trigger Algolia lazy load
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; status?: string }[] = []

      // Algolia InstantSearch renders .ais-Hits-item elements
      document.querySelectorAll(".ais-Hits-item").forEach((item) => {
        const el = item as HTMLElement
        const text = el.innerText || ""

        const nameEl = el.querySelector("h1, h2, h3, h4, h5") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || ""
        if (!name) return

        const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null
        const url = linkEl?.href || ""

        const priceM = text.match(/(?:starting from|from)\s*\$\s*([\d,]+)/i) || text.match(/\$\s*([\d,]+)/)
        const bedM = text.match(/(\d+)\s*(?:BEDROOMS?|BD|BED)/i)
        const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:BATHS?|BA)/i)
        const sqftM = text.match(/([\d,]+)\s*(?:SQUARE FEET|SQ\.?\s*FT|SF)/i)
        const cityM = text.match(/([A-Za-z\s]+),\s*CA/)

        // Status badge (e.g. "NOW SELLING", "FINAL OPPORTUNITY")
        const badgeEl = el.querySelector("[class*='badge'], [class*='status'], [class*='tag']") as HTMLElement | null
        const status = badgeEl?.innerText?.trim()

        results.push({
          name,
          url,
          city: cityM?.[1]?.trim() || "",
          price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          status,
        })
      })

      return results
    })

    console.log(`Found ${communities.length} Risewell OC communities`)

    for (const comm of communities) {
      if (!comm.name) continue
      const price = comm.price && comm.price > 100000 ? comm.price : undefined
      allListings.push({
        communityName: comm.name,
        communityUrl: comm.url || OC_URL,
        address: `${comm.name} - Plans Available`,
        sqft: comm.sqft,
        beds: comm.beds,
        baths: comm.baths,
        price,
        pricePerSqft: price && comm.sqft ? Math.round(price / comm.sqft) : undefined,
        propertyType: "Detached",
        sourceUrl: comm.url || OC_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
