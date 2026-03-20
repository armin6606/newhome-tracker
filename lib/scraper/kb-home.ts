/**
 * KB Home scraper — uses window.regionMapData.communitiesData injected by the page.
 * OC page: https://www.kbhome.com/new-homes-orange-county
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const BASE_URL = "https://www.kbhome.com"
const OC_URL = `${BASE_URL}/new-homes-orange-county`
const PROMOS_URLS = [
  `${BASE_URL}/savings-and-offers`,
  `${BASE_URL}/promotions`,
  `${BASE_URL}/offers`,
]

// Orange County city names to filter from California-wide regionMapData
const OC_CITIES = new Set([
  "irvine", "newport beach", "laguna niguel", "laguna beach", "laguna hills",
  "mission viejo", "lake forest", "rancho santa margarita", "san clemente",
  "san juan capistrano", "aliso viejo", "dana point", "tustin", "orange",
  "anaheim", "yorba linda", "brea", "placentia", "fullerton", "buena park",
  "huntington beach", "fountain valley", "westminster", "garden grove",
  "santa ana", "seal beach", "los alamitos", "cypress", "stanton", "la habra",
  "villa park", "rancho mission viejo", "long beach",
])

interface KBCommunity {
  CommunityId?: string
  CommunityName?: string
  CommunityStatus?: string
  PageUrl?: string
  Url?: string
  PriceMin?: number
  PriceMax?: number
  BedroomsMin?: string
  BedroomsMax?: string
  BathroomsMin?: string
  BathroomsMax?: string
  SizeMin?: string
  SizeMax?: string
  StoriesMin?: string
  GaragesMin?: string
  Style?: string
  City?: string
  CityState?: string
  Address?: string
  ComingSoon?: boolean
}

/** Scrape KB Home builder-wide promotions page for offer details */
async function scrapeKBPromotions(page: import("playwright").Page): Promise<string | undefined> {
  for (const promoUrl of PROMOS_URLS) {
    try {
      console.log(`  Trying KB Home promotions page: ${promoUrl}`)
      const response = await page.goto(promoUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      if (!response || response.status() >= 400) continue
      await page.waitForTimeout(3000)

      const result = await page.evaluate(() => {
        const body = document.body as HTMLElement
        const bodyText = body.innerText || ""

        // Try structured promo/offer elements
        const promoSelectors = [
          '[class*="promo"]', '[class*="Promo"]',
          '[class*="offer"]', '[class*="Offer"]',
          '[class*="incentive"]', '[class*="Incentive"]',
          '[class*="savings"]', '[class*="Savings"]',
          '[class*="hero"] h1', '[class*="hero"] h2',
          '[class*="Hero"] h1', '[class*="Hero"] h2',
          '[class*="banner"]', '[class*="Banner"]',
          '[class*="deal"]', '[class*="Deal"]',
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

        // Regex patterns for financial details
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

export async function scrapeKBHomeOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading KB Home OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(6000)

    const communities: KBCommunity[] = await page.evaluate(() => {
      const rd = (window as any).regionMapData
      return rd?.communitiesData || []
    })

    console.log(`Found ${communities.length} KB Home OC communities`)

    // Scrape the builder-wide promotions page once
    const builderPromo = await scrapeKBPromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }

    for (const c of communities) {
      if (!c.CommunityName) continue
      if (c.ComingSoon) continue
      // Filter to OC cities only
      const city = (c.City || c.CityState?.split(",")[0] || "").toLowerCase().trim()
      if (!OC_CITIES.has(city)) continue

      const pageUrl = c.PageUrl || c.Url || ""
      const communityUrl = pageUrl.startsWith("http") ? pageUrl : `${BASE_URL}${pageUrl}`
      const price = c.PriceMin && c.PriceMin > 100000 ? c.PriceMin : undefined
      const sqft = c.SizeMin ? parseInt(c.SizeMin, 10) : undefined
      const beds = c.BedroomsMin ? parseFloat(c.BedroomsMin) : undefined
      const baths = c.BathroomsMin ? parseFloat(c.BathroomsMin) : undefined
      const floors = c.StoriesMin ? parseInt(c.StoriesMin, 10) : undefined
      const garages = c.GaragesMin ? parseInt(c.GaragesMin, 10) : undefined

      const propertyType = /multi-family|condo|townhome|attached/i.test(c.Style || "") ? "Attached" : "Detached"

      allListings.push({
        communityName: c.CommunityName,
        communityUrl,
        address: c.Address ? `${c.Address}, ${c.CityState || ""}`.trim() : `${c.CommunityName} - Plans Available`,
        sqft,
        beds,
        baths,
        garages,
        floors,
        price,
        pricePerSqft: price && sqft ? Math.round(price / sqft) : undefined,
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
