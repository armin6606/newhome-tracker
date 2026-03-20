/**
 * Shea Homes scraper — uses window.communitySearch injected by the page.
 * OC page: https://www.sheahomes.com/new-homes/california/orange-county/
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.sheahomes.com/new-homes/california/orange-county/"
const BASE_URL = "https://www.sheahomes.com"
const PROMOS_URLS = [
  `${BASE_URL}/special-offers/`,
  `${BASE_URL}/promotions/`,
  `${BASE_URL}/offers/`,
  `${BASE_URL}/incentives/`,
]

interface SheaCommunity {
  Name?: string
  City?: string
  State?: string
  Url?: string
  NodeAliasPath?: string
  HomeTypes?: string[]
  HomeTypesString?: string
  StatusLabel?: string
  PriceMin?: number
  PriceMax?: number
  BedroomsMin?: number
  BedroomsMax?: number
  BathroomsMin?: number
  SqFtMin?: number
  SqFtMax?: number
}

/** Scrape Shea Homes builder-wide promotions page for offer details */
async function scrapeaSheaPromotions(page: import("playwright").Page): Promise<string | undefined> {
  for (const promoUrl of PROMOS_URLS) {
    try {
      console.log(`  Trying Shea Homes promotions page: ${promoUrl}`)
      const response = await page.goto(promoUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      if (!response || response.status() >= 400) continue
      await page.waitForTimeout(3000)

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
  return undefined
}

export async function scrapeaSheaHomesOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Shea Homes OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    const communities: SheaCommunity[] = await page.evaluate(() => {
      const cs = (window as any).communitySearch || (window as any).communitySearchMapJsonV2 || []
      return Array.isArray(cs) ? cs : []
    })

    console.log(`Found ${communities.length} Shea OC communities`)

    // Scrape builder-wide promotions page once
    const builderPromo = await scrapeaSheaPromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }

    for (const c of communities) {
      if (!c.Name) continue
      // Skip sold out
      if (/sold.?out|closed/i.test(c.StatusLabel || "")) continue

      const relUrl = c.Url || c.NodeAliasPath || ""
      const communityUrl = relUrl.startsWith("http") ? relUrl : `${BASE_URL}${relUrl}`
      const price = c.PriceMin && c.PriceMin > 100000 ? c.PriceMin : undefined
      const propertyType = /townhome|townhouse|attached|condo/i.test((c.HomeTypesString || c.HomeTypes?.join(" ") || ""))
        ? "Attached"
        : "Detached"

      allListings.push({
        communityName: c.Name,
        communityUrl,
        address: `${c.Name} - Plans Available`,
        sqft: c.SqFtMin,
        beds: c.BedroomsMin,
        baths: c.BathroomsMin,
        price,
        pricePerSqft: price && c.SqFtMin ? Math.round(price / c.SqFtMin) : undefined,
        propertyType,
        incentives: builderPromo,
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
