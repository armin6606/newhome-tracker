import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.tripointehomes.com/ca/orange-county/"

export async function scrapeTriPointeOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading TRI Pointe OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string }[] = []
      const seen = new Set<string>()

      // TRI Pointe community cards - they use Next.js with Tailwind
      const cards = document.querySelectorAll("a[href*='/community/'], a[href*='/neighborhoods/'], a[href*='/ca/']")
      cards.forEach((a) => {
        const href = (a as HTMLAnchorElement).href
        if (!href || seen.has(href) || !href.includes("tripointehomes.com")) return
        // Filter for OC URLs
        if (!href.includes("/ca/") && !href.includes("orange-county")) return
        seen.add(href)
        const card = a.closest("article, section, div[class*='card'], li") || a
        const nameEl = card.querySelector("h2, h3, h4") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || (a as HTMLElement).innerText?.trim() || ""
        if (!name || name.length > 80) return
        const text = (card as HTMLElement).innerText || ""
        const cityM = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)
        results.push({ name, url: href, city: cityM?.[1] || "" })
      })
      return results
    })

    console.log(`Found ${communities.length} TRI Pointe OC communities`)

    for (const comm of communities) {
      console.log(`  Scraping TRI Pointe: ${comm.name}`)
      try {
        await page.goto(comm.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(3000)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(1500)

        const data = await page.evaluate((url) => {
          const body = (document.body as HTMLElement).innerText || ""
          const results: { address: string; price?: number; beds?: number; baths?: number; sqft?: number; floorPlan?: string; sourceUrl: string }[] = []

          // Try to find individual home/lot cards
          const homeCards = document.querySelectorAll("[class*='HomeCard'], [class*='home-card'], [class*='lot'], [class*='qmi'], [class*='plan']")
          homeCards.forEach((card) => {
            const el = card as HTMLElement
            const text = el.innerText || ""
            if (text.length < 10) return
            const priceM = text.match(/\$\s*([\d,]+)/)
            const bedM = text.match(/(\d+)\s*(?:bd|bed)/i)
            const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath)/i)
            const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf)/i)
            const addrM = text.match(/\d+\s+[A-Z][a-z]/)
            const linkEl = el.querySelector("a") as HTMLAnchorElement | null
            results.push({
              address: addrM?.[0] || (el.querySelector("h3, h4") as HTMLElement)?.innerText?.trim() || "Plan Available",
              price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              sourceUrl: linkEl?.href || url,
            })
          })

          if (results.length === 0) {
            // Community-level data
            const priceM = body.match(/(?:from|starting|priced from)\s*\$\s*([\d,]+)/i) || body.match(/\$\s*([\d,]+)/)
            const bedM = body.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:bed|BD)/i) || body.match(/(\d+)\s*(?:bed|BD)/i)
            const bathM = body.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:bath|BA)/i) || body.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA)/i)
            const sqftM = body.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*(?:sq\.?\s*ft|SF)/i) || body.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)
            const h1 = (document.querySelector("h1") as HTMLElement)?.innerText?.trim() || ""
            results.push({
              address: h1 || "Plans Available",
              price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              sourceUrl: url,
            })
          }
          return results
        }, comm.url)

        for (const home of data) {
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
            sourceUrl: home.sourceUrl,
          })
        }
      } catch (err) {
        console.log(`  Error scraping TRI Pointe ${comm.name}:`, err)
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}
