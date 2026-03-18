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
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
