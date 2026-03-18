import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.taylormorrison.com/ca/orange-county"

export async function scrapeTaylorMorrisonOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []
  const capturedCommunities: any[] = []

  try {
    const page = await context.newPage()

    // Intercept JSON responses for community search API
    page.on("response", async (response) => {
      const url = response.url()
      if (
        (url.includes("communities") || url.includes("search") || url.includes("state")) &&
        response.headers()["content-type"]?.includes("json")
      ) {
        try {
          const json = await response.json()
          if (json?.communities || json?.results || Array.isArray(json)) {
            capturedCommunities.push(json)
          }
        } catch {}
      }
    })

    console.log("Loading Taylor Morrison OC page...")
    await page.goto(OC_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    let communities: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number }[] = []

    // Try captured JSON
    for (const json of capturedCommunities) {
      const items = json?.communities || json?.results || (Array.isArray(json) ? json : [])
      if (Array.isArray(items) && items.length > 0) {
        communities = items.map((c: any) => ({
          name: c.communityName || c.name || c.title || "",
          url: c.communityUrl || c.url || c.link || "",
          city: c.city || c.cityName || "",
          price: c.basePrice || c.priceFrom || c.minimumPrice,
          beds: c.minBedrooms || c.beds,
          baths: c.minBathrooms || c.baths,
          sqft: c.minSquareFootage || c.sqft,
        })).filter((c: any) => c.name)
        if (communities.length > 0) break
      }
    }

    // Fallback to DOM
    if (communities.length === 0) {
      communities = await page.evaluate(() => {
        const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number }[] = []
        const seen = new Set<string>()

        document.querySelectorAll("[class*='community-card'], [class*='CommunityCard'], [class*='community-item'], article").forEach((card) => {
          const linkEl = card.querySelector("a[href]") as HTMLAnchorElement | null
          const url = linkEl?.href || ""
          if (!url || seen.has(url)) return
          seen.add(url)

          const nameEl = card.querySelector("h2, h3, h4, [class*='name'], [class*='title']") as HTMLElement | null
          const name = nameEl?.innerText?.trim() || ""
          if (!name) return

          const text = (card as HTMLElement).innerText || ""
          const priceM = text.match(/(?:from|starting)?\s*\$\s*([\d,]+)/i)
          const bedM = text.match(/(\d+)\s*(?:bd|bed|bedroom)/i)
          const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath)/i)
          const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf)/i)
          const cityM = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)

          results.push({
            name,
            url,
            city: cityM?.[1] || "",
            price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
            beds: bedM ? parseFloat(bedM[1]) : undefined,
            baths: bathM ? parseFloat(bathM[1]) : undefined,
            sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          })
        })
        return results
      })
    }

    console.log(`Found ${communities.length} Taylor Morrison OC communities`)

    for (const comm of communities) {
      if (!comm.name) continue
      const price = comm.price && comm.price > 100000 ? comm.price : undefined
      allListings.push({
        communityName: comm.name,
        communityUrl: comm.url || OC_URL,
        address: `${comm.name} - Plans Available`,
        sqft: comm.sqft,
        beds: comm.beds,
        baths: comm.baths,
        price,
        pricePerSqft: price && comm.sqft ? Math.round(price / comm.sqft) : undefined,
        propertyType: "Detached",
        sourceUrl: comm.url || OC_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
