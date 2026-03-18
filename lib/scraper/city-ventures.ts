/**
 * City Ventures scraper.
 * WordPress server-rendered. Cards use article.card.oi-map-item.
 * OC filter: data-county="Orange" on article elements.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const LISTING_URL = "https://cityventures.com/new-homes/"

export async function scrapeCityVenturesOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading City Ventures page...")
    await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; status?: string }[] = []

      // Filter to OC cards using data-county or city matching
      const ocCities = ["santa ana", "anaheim", "orange", "fullerton", "irvine", "laguna", "newport", "garden grove", "huntington beach", "westminster", "stanton", "cypress", "seal beach", "fountain valley", "buena park", "la habra", "yorba linda", "placentia", "tustin", "san clemente", "san juan capistrano", "mission viejo", "lake forest", "rancho santa margarita"]

      document.querySelectorAll("article.card, .card.oi-map-item, article[data-listing-id]").forEach((card) => {
        const el = card as HTMLElement
        const county = el.getAttribute("data-county") || ""
        const text = el.innerText?.toLowerCase() || ""

        const isOC = /orange/i.test(county) || ocCities.some((c) => text.includes(c))
        if (!isOC) return

        const nameEl = el.querySelector("h3, h2, .body h3") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || ""
        if (!name) return

        const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null
        const url = linkEl?.href || ""

        const priceM = text.match(/from\s*\$\s*([\d,]+)/i) || text.match(/\$\s*([\d,]+)/)
        const price = el.getAttribute("data-price") ? parseInt(el.getAttribute("data-price") || "0", 10) : priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined

        const bedM = text.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*bed/i) || text.match(/(\d+)\s*bed/i)
        const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*([\d.]+)\s*bath/i) || text.match(/(\d+(?:\.\d+)?)\s*bath/i)
        const sqftAttr = el.getAttribute("data-square-feet")
        const sqftTextM = text.match(/([\d,]+)\s*(?:-|to)\s*([\d,]+)\s*sq/i)
        const sqftM = sqftAttr ? parseInt(sqftAttr, 10) : sqftTextM ? parseInt(sqftTextM[1].replace(/,/g, ""), 10) : undefined

        const cityMatch = text.match(/([a-z\s]+),\s*ca/)
        const cityEl = el.querySelector(".text-uppercase, [class*='city']") as HTMLElement | null

        results.push({
          name,
          url,
          city: cityEl?.innerText?.trim() || cityMatch?.[1]?.trim() || "",
          price: price && price > 0 ? price : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: typeof sqftM === "number" && sqftM > 0 ? sqftM : undefined,
        })
      })

      return results
    })

    console.log(`Found ${communities.length} City Ventures OC communities`)

    for (const comm of communities) {
      if (!comm.name) continue
      const price = comm.price && comm.price > 100000 ? comm.price : undefined
      allListings.push({
        communityName: comm.name,
        communityUrl: comm.url || LISTING_URL,
        address: `${comm.name} - Plans Available`,
        sqft: comm.sqft,
        beds: comm.beds,
        baths: comm.baths,
        price,
        pricePerSqft: price && comm.sqft ? Math.round(price / comm.sqft) : undefined,
        propertyType: "Attached",
        sourceUrl: comm.url || LISTING_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
