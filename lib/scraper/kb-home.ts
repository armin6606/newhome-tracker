/**
 * KB Home scraper — uses window.regionMapData.communitiesData injected by the page.
 * OC page: https://www.kbhome.com/new-homes-orange-county
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const BASE_URL = "https://www.kbhome.com"
const OC_URL = `${BASE_URL}/new-homes-orange-county`

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

/** Extract incentive text from a KB Home community page */
async function scrapeKBIncentives(page: import("playwright").Page, url: string): Promise<string | undefined> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(3000)

    return await page.evaluate(() => {
      const body = (document.body as HTMLElement).innerText || ""

      // Try CSS selectors for incentive elements
      const selectors = [
        '[class*="incentive"]', '[class*="Incentive"]',
        '[class*="promotion"]', '[class*="Promotion"]',
        '[class*="offer"]', '[class*="Offer"]',
        '[class*="special"]', '[class*="Special"]',
        '[class*="closing"]', '[class*="buydown"]',
        '[class*="credit"]', '[class*="Credit"]',
        '[class*="savings"]', '[class*="Savings"]',
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        const txt = el?.innerText?.trim()
        if (txt && txt.length > 5 && txt.length < 500) return txt
      }

      // Regex fallback on page text
      const patterns = [
        /(?:closing\s+cost\s+(?:credit|assistance)|rate\s+buy[-\s]?down|flex\s+cash|design\s+(?:credit|dollars?)|upgrade\s+credit|builder\s+incentive|special\s+offer|limited[-\s]time\s+offer)\s*[:\-–]?\s*([^\n.]{5,120})/gi,
      ]
      const matches: string[] = []
      for (const pat of patterns) {
        let m: RegExpExecArray | null
        while ((m = pat.exec(body)) !== null) {
          matches.push(m[0].trim())
          if (matches.length >= 3) break
        }
      }
      if (matches.length) return matches.join(" | ")

      return undefined
    })
  } catch {
    return undefined
  }
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

      // Scrape incentives from community page
      console.log(`  Checking incentives: ${c.CommunityName}`)
      const incentives = await scrapeKBIncentives(page, communityUrl)
      await page.waitForTimeout(500)

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
        incentives,
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
