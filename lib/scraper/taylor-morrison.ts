/**
 * Taylor Morrison OC scraper.
 * Uses [class*="community-card"] DOM elements, filtered to OC cities.
 * Page: https://www.taylormorrison.com/ca/orange-county
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.taylormorrison.com/ca/orange-county"
const BASE_URL = "https://www.taylormorrison.com"
const PROMOS_URL = "https://www.taylormorrison.com/make-moves"

const OC_CITIES = [
  "irvine", "newport beach", "laguna niguel", "laguna beach", "laguna hills",
  "mission viejo", "lake forest", "rancho santa margarita", "san clemente",
  "san juan capistrano", "aliso viejo", "dana point", "tustin", "orange",
  "anaheim", "yorba linda", "brea", "placentia", "fullerton", "buena park",
  "huntington beach", "fountain valley", "westminster", "garden grove",
  "santa ana", "seal beach", "los alamitos", "cypress", "stanton", "la habra",
  "villa park", "rancho mission viejo",
]

/** Scrape the Taylor Morrison /make-moves promotions page for builder-wide offer text */
async function scrapeTaylorMorrisonPromotions(page: import("playwright").Page): Promise<string | undefined> {
  try {
    console.log("Loading Taylor Morrison promotions page...")
    await page.goto(PROMOS_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(4000)

    return await page.evaluate(() => {
      const body = document.body as HTMLElement
      const bodyText = body.innerText || ""

      // Try structured promo elements first
      const promoSelectors = [
        '[class*="promo"]', '[class*="Promo"]',
        '[class*="offer"]', '[class*="Offer"]',
        '[class*="incentive"]', '[class*="Incentive"]',
        '[class*="hero"] h1', '[class*="hero"] h2',
        '[class*="Hero"] h1', '[class*="Hero"] h2',
        '[class*="banner"]', '[class*="Banner"]',
        'main h1', 'main h2',
      ]

      const parts: string[] = []
      const seen = new Set<string>()
      for (const sel of promoSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const txt = (el as HTMLElement).innerText?.trim()
          if (txt && txt.length > 10 && txt.length < 500 && !seen.has(txt)) {
            seen.add(txt)
            parts.push(txt)
          }
        })
        if (parts.length >= 3) break
      }

      // Regex patterns for dollar amounts, rates, and offer details
      const patterns = [
        /(?:reduced\s+rate|no\s+(?:monthly\s+)?(?:mortgage\s+)?insurance|buy[-\s]?down|closing\s+cost|flex\s+cash|design\s+credit)[^\n]{0,200}/gi,
        /(?:save|get|receive|up\s+to)\s+\$[\d,]+[^\n]{0,150}/gi,
        /\d+(?:\.\d+)?%\s+(?:interest|rate|APR|fixed)[^\n]{0,150}/gi,
        /(?:limited[-\s]time|special\s+offer|exclusive\s+offer)[^\n]{0,200}/gi,
      ]

      for (const pat of patterns) {
        let m: RegExpExecArray | null
        while ((m = pat.exec(bodyText)) !== null) {
          const txt = m[0].trim()
          if (txt.length > 10 && !seen.has(txt)) {
            seen.add(txt)
            parts.push(txt)
          }
          if (parts.length >= 5) break
        }
      }

      if (parts.length > 0) {
        // Deduplicate and join
        return parts.slice(0, 5).join(" | ")
      }

      return undefined
    })
  } catch (err) {
    console.log("  Could not load Taylor Morrison promotions page:", err)
    return undefined
  }
}

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
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; garages?: number; status?: string; incentives?: string }[] = []
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

        // Check for incentive text within the card
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
          const incEl = el.querySelector(sel) as HTMLElement | null
          const txt = incEl?.innerText?.trim()
          if (txt && txt.length > 5 && txt.length < 500) { incentives = txt; break }
        }

        // Regex fallback on card text
        if (!incentives) {
          const incPatterns = [
            /(?:closing\s+cost\s+(?:credit|assistance)|rate\s+buy[-\s]?down|flex\s+cash|design\s+(?:credit|dollars?)|upgrade\s+credit|builder\s+incentive|special\s+offer|limited[-\s]time\s+offer)\s*[:\-–]?\s*([^\n.]{5,120})/gi,
          ]
          const matches: string[] = []
          for (const pat of incPatterns) {
            let m: RegExpExecArray | null
            while ((m = pat.exec(text)) !== null) {
              matches.push(m[0].trim())
              if (matches.length >= 3) break
            }
          }
          if (matches.length) incentives = matches.join(" | ")
        }

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
          incentives,
        })
      })

      return results
    }, OC_CITIES)

    console.log(`Found ${communities.length} Taylor Morrison OC communities`)

    // Scrape the builder-wide promotions page
    const builderPromo = await scrapeTaylorMorrisonPromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }

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
        incentives: c.incentives || builderPromo,
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
