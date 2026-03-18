/**
 * Brandywine Homes scraper.
 * WordPress server-rendered. Cards use .list-item.
 * OC communities: Solara (Westminster), The Gables (Garden Grove).
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const LISTING_URL = "https://www.brandywine-homes.com/find-your-home/"

const OC_CITIES = ["westminster", "garden grove", "anaheim", "irvine", "orange", "huntington beach", "fullerton", "buena park", "santa ana", "cypress", "la palma", "seal beach", "los alamitos", "stanton", "fountain valley", "laguna", "mission viejo", "lake forest", "rancho santa margarita", "san clemente", "tustin", "newport", "yorba linda", "placentia", "brea", "la habra"]

export async function scrapeBrandywineOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Brandywine Homes page...")
    await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    const communities = await page.evaluate((ocCities) => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; sqft?: number; status?: string; propertyType?: string }[] = []

      document.querySelectorAll(".list-item").forEach((card) => {
        const el = card as HTMLElement
        const text = el.innerText?.toLowerCase() || ""

        const isOC = ocCities.some((c: string) => text.includes(c))
        if (!isOC) return

        const nameEl = el.querySelector(".list-text h2") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || ""
        if (!name) return

        const statusEl = el.querySelector(".list-text h3") as HTMLElement | null
        const status = statusEl?.innerText?.trim() || ""
        // Skip sold out
        if (/sold.?out/i.test(status)) return

        const priceEl = el.querySelector(".list-text h4") as HTMLElement | null
        const priceText = priceEl?.innerText || ""
        const priceM = priceText.match(/\$\s*([\d,]+)/)
        const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined

        // Parse "p" text: "Westminster, CA\n25 New Townhomes\n2-4 Bedrooms • 1,256 - 1,698 sq. ft."
        const pEl = el.querySelector(".list-text p") as HTMLElement | null
        const pText = pEl?.innerText || ""
        const cityM = pText.match(/([A-Za-z\s]+),\s*CA/)
        const bedM = pText.match(/(\d+)\s*[-–]\s*(\d+)\s*Bed/i) || pText.match(/(\d+)\s*Bed/i)
        const sqftM = pText.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*sq/i) || pText.match(/([\d,]+)\s*sq/i)
        const typeM = pText.match(/(townhome|townhouse|condo|single.family|flat)/i) || text.match(/(townhome|townhouse|condo|single.family|flat)/i)

        const linkEl = el.querySelector(".list-text a[href]") as HTMLAnchorElement | null
        const url = linkEl?.href || ""

        results.push({
          name,
          url,
          city: cityM?.[1]?.trim() || "",
          price: price && price > 100000 ? price : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          status,
          propertyType: typeM ? typeM[1] : "Attached",
        })
      })

      return results
    }, OC_CITIES)

    console.log(`Found ${communities.length} Brandywine OC communities`)

    for (const comm of communities) {
      if (!comm.name) continue
      allListings.push({
        communityName: comm.name,
        communityUrl: comm.url || LISTING_URL,
        address: `${comm.name} - Plans Available`,
        sqft: comm.sqft,
        beds: comm.beds,
        price: comm.price,
        pricePerSqft: comm.price && comm.sqft ? Math.round(comm.price / comm.sqft) : undefined,
        propertyType: comm.propertyType || "Attached",
        sourceUrl: comm.url || LISTING_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
