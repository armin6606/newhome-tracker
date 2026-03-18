/**
 * Taylor Morrison OC scraper.
 * Uses [class*="community-card"] DOM elements, filtered to OC cities.
 * Page: https://www.taylormorrison.com/ca/orange-county
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.taylormorrison.com/ca/orange-county"
const BASE_URL = "https://www.taylormorrison.com"

const OC_CITIES = [
  "irvine", "newport beach", "laguna niguel", "laguna beach", "laguna hills",
  "mission viejo", "lake forest", "rancho santa margarita", "san clemente",
  "san juan capistrano", "aliso viejo", "dana point", "tustin", "orange",
  "anaheim", "yorba linda", "brea", "placentia", "fullerton", "buena park",
  "huntington beach", "fountain valley", "westminster", "garden grove",
  "santa ana", "seal beach", "los alamitos", "cypress", "stanton", "la habra",
  "villa park", "rancho mission viejo",
]

export async function scrapeTaylorMorrisonOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Taylor Morrison OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(6000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const communities = await page.evaluate((ocCities) => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; garages?: number; status?: string }[] = []
      const seen = new Set<string>()

      document.querySelectorAll("[class*='community-card']").forEach((card) => {
        const el = card as HTMLElement
        const text = el.innerText || ""
        const lowerText = text.toLowerCase()

        // Filter to OC cities
        const isOC = ocCities.some((city: string) => lowerText.includes(city))
        if (!isOC) return

        const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null
        const href = linkEl?.href || ""
        if (seen.has(href)) return
        seen.add(href)

        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
        const name = lines.find((l) => l.length > 3 && l.length < 80 && !/^From|^\$|^\d|^Model|^New|^Coming/i.test(l)) || lines[0] || ""
        const cityLine = lines.find((l) => /,\s*California/i.test(l)) || ""
        const city = cityLine.split(",")[0].trim()

        const priceM = text.match(/From\s*\$\s*([\d,]+)/i)
        const bedM = text.match(/(\d+)\s*(?:-\s*\d+\s*)?Bed/i)
        const bathM = text.match(/([\d.]+)\s*(?:-\s*[\d.]+\s*)?Bath/i)
        const sqftM = text.match(/([\d,]+)\s*(?:-\s*[\d,]+\s*)?Sq\.?\s*Ft/i)
        const garM = text.match(/(\d+)\s*Garage/i)
        const statusM = lines.find((l) => /models? open|coming soon|now selling|move.in/i.test(l))

        results.push({
          name,
          url: href,
          city,
          price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          garages: garM ? parseInt(garM[1], 10) : undefined,
          status: statusM,
        })
      })

      return results
    }, OC_CITIES)

    console.log(`Found ${communities.length} Taylor Morrison OC communities`)

    for (const c of communities) {
      if (!c.name) continue
      const communityUrl = c.url.startsWith("http") ? c.url : `${BASE_URL}${c.url}`
      const price = c.price && c.price > 100000 ? c.price : undefined
      allListings.push({
        communityName: c.name,
        communityUrl,
        address: `${c.name} - Plans Available`,
        sqft: c.sqft,
        beds: c.beds,
        baths: c.baths,
        garages: c.garages,
        price,
        pricePerSqft: price && c.sqft ? Math.round(price / c.sqft) : undefined,
        propertyType: "Detached",
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
