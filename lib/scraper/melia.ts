/**
 * Melia Homes scraper.
 * Server-rendered PHP/WordPress via Homefiniti platform.
 * POSTs to /new-homes/ with geo_county=Orange County, CA filter.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const LISTING_URL = "https://meliahomes.com/new-homes/"

function parsePrice(text: string): number | undefined {
  // Handles "$800,000's", "from the High $700,000's", "$1,200,000"
  const m = text.replace(/,/g, "").match(/\$\s*(\d{5,7})/)
  if (!m) return undefined
  const base = parseInt(m[1], 10)
  if (isNaN(base)) return undefined
  // If ends in 000s/000, it's already the price; if it's like "800" from "800,000's" handle separately
  if (base < 10000) return base * 1000
  return base
}

export async function scrapeMeliaHomesOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Melia Homes page...")
    await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    // Submit the OC filter form
    const filtered = await page.evaluate(async () => {
      const form = document.querySelector("form.oi-filter-form") as HTMLFormElement | null
      if (form) {
        const select = form.querySelector('[name="geo_county"], select') as HTMLSelectElement | null
        if (select) {
          // Find Orange County option
          const opt = Array.from(select.options).find((o) => /orange/i.test(o.text))
          if (opt) {
            select.value = opt.value
            select.dispatchEvent(new Event("change", { bubbles: true }))
            return true
          }
        }
      }
      return false
    })

    if (filtered) {
      // Submit the filter
      await page.evaluate(() => {
        const btn = document.querySelector("form.oi-filter-form [type='submit'], form.oi-filter-form button") as HTMLElement | null
        btn?.click()
      })
      await page.waitForTimeout(3000)
    }

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; propertyType?: string }[] = []

      document.querySelectorAll("div.card, .card.border-0").forEach((card) => {
        const el = card as HTMLElement
        const text = el.innerText || ""

        // Filter to OC cities
        const ocCities = ["anaheim", "brea", "buena park", "cypress", "fountain valley", "fullerton", "garden grove", "huntington beach", "irvine", "la habra", "la palma", "laguna beach", "laguna hills", "laguna niguel", "lake forest", "los alamitos", "mission viejo", "newport beach", "orange", "placentia", "rancho santa margarita", "san clemente", "san juan capistrano", "santa ana", "seal beach", "stanton", "tustin", "villa park", "westminster", "yorba linda"]
        const lowerText = text.toLowerCase()
        const isOC = ocCities.some((city) => lowerText.includes(city))
        if (!isOC) return

        const nameEl = el.querySelector("h6.fw-semibold, h5.card-title, .card-title") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || ""
        if (!name) return

        const linkEl = el.querySelector("a.oi-infowindow-header, a[href]") as HTMLAnchorElement | null
        const url = linkEl?.href || ""

        const cityEl = el.querySelector("span.fw-semibold.small, [class*='city'], [class*='location']") as HTMLElement | null
        const cityText = cityEl?.innerText?.trim() || ""
        const cityM = (cityText || text).match(/([A-Za-z\s]+),\s*CA/)

        const priceTxt = (el.querySelector("p.fw-bold, [class*='price']") as HTMLElement)?.innerText || text
        const priceM = priceTxt.match(/\$\s*([\d,]+)/)

        const bedM = text.match(/(\d+)\s*(?:bed|BD|Bedroom)/i)
        const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA|Bathroom)/i)
        const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)
        const typeM = text.match(/(townhome|townhouse|condo|detached|single.family|flat)/i)

        results.push({
          name,
          url,
          city: cityM?.[1]?.trim() || "",
          price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          propertyType: typeM ? typeM[1].replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
        })
      })

      return results
    })

    console.log(`Found ${communities.length} Melia OC communities`)

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
        propertyType: comm.propertyType || "Attached",
        sourceUrl: comm.url || LISTING_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
