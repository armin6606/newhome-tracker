/**
 * Melia Homes scraper.
 * Server-rendered PHP/WordPress via Homefiniti platform.
 * POSTs to /new-homes/ with geo_county=Orange County, CA filter.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"
import { randomDelayMs, randomUserAgent } from "./utils"

const LISTING_URL = "https://meliahomes.com/new-homes/"
const PROMOS_URLS = [
  "https://meliahomes.com/promotions/",
  "https://meliahomes.com/special-offers/",
  "https://meliahomes.com/offers/",
  "https://meliahomes.com/incentives/",
]

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

/** Scrape Melia Homes builder-wide promotions page for offer details */
async function scrapeMeliaPromotions(page: import("playwright").Page): Promise<string | undefined> {
  for (const promoUrl of PROMOS_URLS) {
    try {
      console.log(`  Trying Melia promotions page: ${promoUrl}`)
      const response = await page.goto(promoUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      if (!response || response.status() >= 400) continue
      await page.waitForTimeout(randomDelayMs(2000, 4000))

      const result = await page.evaluate(() => {
        const body = document.body as HTMLElement
        const bodyText = body.innerText || ""

        const promoSelectors = [
          '[class*="promo"]', '[class*="Promo"]',
          '[class*="offer"]', '[class*="Offer"]',
          '[class*="incentive"]', '[class*="Incentive"]',
          '[class*="savings"]', '[class*="Savings"]',
          '[class*="hero"] h1', '[class*="hero"] h2',
          '[class*="banner"]', '[class*="Banner"]',
          '[class*="deal"]', '[class*="Deal"]',
          '[class*="special"]', '[class*="Special"]',
          'main h1', 'main h2', 'main h3',
          '.entry-content h2', '.entry-content h3',
          '.entry-content p',
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

        const patterns = [
          /(?:save|get|receive|up\s+to)\s+\$[\d,]+[^\n]{0,150}/gi,
          /\$[\d,]+\s+(?:toward|in|off|credit|closing|savings)[^\n]{0,150}/gi,
          /\d+(?:\.\d+)?%\s+(?:interest|rate|APR|fixed|down)[^\n]{0,150}/gi,
          /(?:closing\s+cost|rate\s+buy[-\s]?down|flex\s+cash|design\s+credit|upgrade\s+credit)[^\n]{0,200}/gi,
          /(?:limited[-\s]time|special\s+offer|exclusive|don'?t\s+miss)[^\n]{0,200}/gi,
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

        if (parts.length > 0) return parts.slice(0, 5).join(" | ")
        return undefined
      })

      if (result) return result
    } catch {
      continue
    }
  }

  // Also check the main homepage for banner promotions
  try {
    console.log("  Checking Melia homepage for promotions banner...")
    const response = await page.goto("https://meliahomes.com/", { waitUntil: "domcontentloaded", timeout: 20000 })
    if (response && response.status() < 400) {
      await page.waitForTimeout(randomDelayMs(2000, 4000))

      const result = await page.evaluate(() => {
        const bodyText = document.body.innerText || ""
        const patterns = [
          /(?:save|get|receive|up\s+to)\s+\$[\d,]+[^\n]{0,150}/gi,
          /\$[\d,]+\s+(?:toward|in|off|credit|closing|savings)[^\n]{0,150}/gi,
          /(?:closing\s+cost|rate\s+buy[-\s]?down|flex\s+cash|design\s+credit)[^\n]{0,200}/gi,
          /(?:limited[-\s]time|special\s+offer|exclusive)[^\n]{0,200}/gi,
        ]
        const parts: string[] = []
        const seen = new Set<string>()
        for (const pat of patterns) {
          let m: RegExpExecArray | null
          while ((m = pat.exec(bodyText)) !== null) {
            const txt = m[0].trim()
            if (txt.length > 10 && !seen.has(txt)) {
              seen.add(txt)
              parts.push(txt)
            }
            if (parts.length >= 3) break
          }
        }
        if (parts.length > 0) return parts.slice(0, 3).join(" | ")
        return undefined
      })

      if (result) return result
    }
  } catch {
    // ignore
  }

  return undefined
}

export async function scrapeMeliaHomesOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Melia Homes page...")
    await page.goto(LISTING_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

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
      await page.waitForTimeout(randomDelayMs(2000, 4000))
    }

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; propertyType?: string; incentives?: string }[] = []

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
          url,
          city: cityM?.[1]?.trim() || "",
          price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          propertyType: typeM ? typeM[1].replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
          incentives,
        })
      })

      return results
    })

    console.log(`Found ${communities.length} Melia OC communities`)

    // Scrape builder-wide promotions page
    const builderPromo = await scrapeMeliaPromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }

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
        incentives: comm.incentives || builderPromo,
        sourceUrl: comm.url || LISTING_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
