/**
 * Pulte Group scraper — covers both Pulte and Del Webb brands.
 * Both brands share the same Sitecore-based platform.
 * Uses network interception to capture the JSON API response.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const PULTE_OC_URL = "https://www.pulte.com/homes/california/orange-county"
const DELWEBB_OC_URL = "https://www.delwebb.com/homes/california/orange-county"

interface PulteApiCommunity {
  communityName?: string
  name?: string
  city?: string
  state?: string
  address?: string
  url?: string
  communityUrl?: string
  minimumPrice?: number
  displayPrice?: string
  priceFrom?: number
  minBeds?: number
  maxBeds?: number
  minBaths?: number
  maxBaths?: number
  minSqFt?: number
  maxSqFt?: number
  sqFt?: number
  minGarages?: number
  homesiteUrl?: string
  quickMoveIns?: any[]
}

function parsePrice(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const m = text.replace(/,/g, "").match(/\d{5,7}/)
  return m ? parseInt(m[0], 10) : undefined
}

async function scrapePulteBrand(brandUrl: string, brandName: string): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []
  const capturedJson: any[] = []

  try {
    const page = await context.newPage()

    // Intercept API responses
    page.on("response", async (response) => {
      const url = response.url()
      if (
        (url.includes("/api/") || url.includes("community") || url.includes("search")) &&
        response.headers()["content-type"]?.includes("json")
      ) {
        try {
          const json = await response.json()
          capturedJson.push(json)
        } catch {}
      }
    })

    console.log(`Loading ${brandName} OC page...`)
    await page.goto(brandUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(3000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    // Try to extract from captured JSON
    let communities: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number }[] = []

    for (const json of capturedJson) {
      const items = json?.communities || json?.results || json?.data?.communities || json?.items || []
      if (Array.isArray(items) && items.length > 0) {
        communities = items.map((c: PulteApiCommunity) => ({
          name: c.communityName || c.name || "",
          url: c.communityUrl || c.url || "",
          city: c.city || "",
          price: c.minimumPrice || c.priceFrom || parsePrice(c.displayPrice),
          beds: c.minBeds,
          baths: c.minBaths,
          sqft: c.minSqFt,
        })).filter((c: any) => c.name)
        if (communities.length > 0) break
      }
    }

    // Fallback to DOM scraping
    if (communities.length === 0) {
      communities = await page.evaluate(() => {
        const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number }[] = []
        const seen = new Set<string>()

        document.querySelectorAll(".ProductSummary__community, [class*='community-card'], [class*='CommunityCard']").forEach((card) => {
          const nameEl = card.querySelector(".ProductSummary__headline, h2, h3, [class*='name']") as HTMLElement | null
          const name = nameEl?.innerText?.trim() || ""
          if (!name) return

          const linkEl = card.querySelector("a[href], [data-href]") as HTMLAnchorElement | null
          const url = (linkEl as HTMLAnchorElement)?.href || (linkEl as HTMLElement)?.getAttribute("data-href") || ""
          if (!url || seen.has(url)) return
          seen.add(url)

          const text = (card as HTMLElement).innerText || ""
          const priceM = text.match(/\$\s*([\d,]+)/)
          const bedM = text.match(/(\d+)\s*[-–]?\s*\d*\s*(?:bed|BD|Bedroom)/i)
          const bathM = text.match(/(\d+(?:\.\d+)?)\s*[-–]?\s*[\d.]*\s*(?:bath|BA|Bathroom)/i)
          const cityM = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)

          results.push({
            name,
            url,
            city: cityM?.[1] || "",
            price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
            beds: bedM ? parseFloat(bedM[1]) : undefined,
            baths: bathM ? parseFloat(bathM[1]) : undefined,
          })
        })
        return results
      })
    }

    console.log(`Found ${communities.length} ${brandName} OC communities`)

    for (const comm of communities) {
      if (!comm.name) continue
      const price = comm.price && comm.price > 100000 ? comm.price : undefined
      allListings.push({
        communityName: comm.name,
        communityUrl: comm.url || brandUrl,
        address: `${comm.name} - Plans Available`,
        sqft: comm.sqft,
        beds: comm.beds,
        baths: comm.baths,
        price,
        pricePerSqft: price && comm.sqft ? Math.round(price / comm.sqft) : undefined,
        propertyType: "Detached",
        sourceUrl: comm.url || brandUrl,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}

export async function scrapePulteOC(): Promise<ScrapedListing[]> {
  return scrapePulteBrand(PULTE_OC_URL, "Pulte")
}

export async function scrapeDelWebbOC(): Promise<ScrapedListing[]> {
  return scrapePulteBrand(DELWEBB_OC_URL, "Del Webb")
}
