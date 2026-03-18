/**
 * Shea Homes scraper — uses window.communitySearch injected by the page.
 * OC page: https://www.sheahomes.com/new-homes/california/orange-county/
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.sheahomes.com/new-homes/california/orange-county/"
const BASE_URL = "https://www.sheahomes.com"

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
        sourceUrl: communityUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
