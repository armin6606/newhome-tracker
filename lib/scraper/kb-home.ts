import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const BASE_URL = "https://www.kbhome.com"
const OC_URL = `${BASE_URL}/new-homes-orange-county`

function parsePrice(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const m = text.replace(/,/g, "").match(/\d{5,7}/)
  return m ? parseInt(m[0], 10) : undefined
}

function parseNum(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const n = parseFloat(text.replace(/,/g, "").match(/[\d.]+/)?.[0] || "")
  return isNaN(n) ? undefined : n
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
    await page.waitForTimeout(4000)

    // Scroll to load all cards
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    // Get community links from the page
    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string }[] = []
      const seen = new Set<string>()

      // KB Home community cards
      document.querySelectorAll('a[href*="/community/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href
        if (!href || seen.has(href)) return
        seen.add(href)
        const card = a.closest("article, .community-card, [class*='community'], li") || a
        const text = card.textContent || a.textContent || ""
        const nameEl = card.querySelector("h2, h3, h4, [class*='name'], [class*='title']") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || (a as HTMLElement).innerText?.trim() || ""
        if (!name) return
        // Try to find city
        const cityEl = card.querySelector("[class*='city'], [class*='location'], [class*='address']") as HTMLElement | null
        const city = cityEl?.innerText?.trim() || ""
        results.push({ name, url: href, city })
      })
      return results
    })

    console.log(`Found ${communities.length} KB Home OC communities`)

    for (const comm of communities) {
      console.log(`  Scraping KB Home community: ${comm.name}`)
      try {
        await page.goto(comm.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(3000)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(1500)

        const homes = await page.evaluate((commUrl) => {
          const results: {
            address: string; price?: number; beds?: number; baths?: number
            sqft?: number; floorPlan?: string; status?: string; sourceUrl: string
            lotNumber?: string
          }[] = []

          // Look for individual home/lot cards
          const homeCards = document.querySelectorAll(
            '[class*="HomeCard"], [class*="home-card"], [class*="lot-card"], [class*="QMI"], [class*="plan-card"], .home-card, .lot-card'
          )

          homeCards.forEach((card) => {
            const el = card as HTMLElement
            const addressEl = el.querySelector("[class*='address'], [class*='street']") as HTMLElement | null
            const priceEl = el.querySelector("[class*='price'], [class*='Price']") as HTMLElement | null
            const planEl = el.querySelector("[class*='plan'], [class*='Plan'], h2, h3") as HTMLElement | null
            const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null

            const text = el.innerText || ""
            const bedM = text.match(/(\d+(?:\.\d+)?)\s*(?:bd|bed)/i)
            const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath)/i)
            const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|sf)/i)
            const priceM = text.match(/\$\s*([\d,]+)/)

            const address = addressEl?.innerText?.trim() || ""
            const sourceUrl = linkEl?.href || commUrl

            if (!address && !planEl?.innerText?.trim()) return

            results.push({
              address: address || planEl?.innerText?.trim() || "Plan Available",
              price: priceEl ? parseInt(priceEl.innerText.replace(/[^0-9]/g, ""), 10) || undefined : priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              floorPlan: planEl?.innerText?.trim(),
              sourceUrl,
            })
          })

          // If no individual cards found, create one entry for the community with range data
          if (results.length === 0) {
            const body = (document.body as HTMLElement).innerText || ""
            const priceM = body.match(/(?:from|starting|priced from)\s*\$\s*([\d,]+)/i)
            const bedM = body.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:bed|BD)/i) || body.match(/(\d+)\s*(?:bed|BD)/i)
            const bathM = body.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:bath|BA)/i) || body.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA)/i)
            const sqftM = body.match(/([\d,]+)\s*(?:-|to)\s*([\d,]+)\s*(?:sq\.?\s*ft|SF)/i) || body.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)
            const h1 = (document.querySelector("h1") as HTMLElement)?.innerText?.trim() || ""

            results.push({
              address: h1 || "Plans Available",
              price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              sourceUrl: commUrl,
            })
          }

          return results
        }, comm.url)

        // Determine city from URL or page
        const cityFromUrl = comm.url.match(/\/([a-z-]+)\/[^/]+$/)?.[1]?.replace(/-/g, " ") || comm.city || "Orange County"
        const cityTitle = cityFromUrl.replace(/\b\w/g, (c) => c.toUpperCase())

        for (const home of homes) {
          const price = home.price && home.price > 100000 ? home.price : undefined
          allListings.push({
            communityName: comm.name,
            communityUrl: comm.url,
            address: home.address,
            floorPlan: home.floorPlan,
            sqft: home.sqft,
            beds: home.beds,
            baths: home.baths,
            price,
            pricePerSqft: price && home.sqft ? Math.round(price / home.sqft) : undefined,
            propertyType: /townhome|townhouse|attached/i.test(comm.name) ? "Attached" : "Detached",
            moveInDate: undefined,
            sourceUrl: home.sourceUrl,
          })
        }
      } catch (err) {
        console.log(`  Error scraping KB Home community ${comm.name}:`, err)
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}
