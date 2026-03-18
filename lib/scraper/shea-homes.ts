import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.sheahomes.com/new-homes/california/orange-county/"

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
    await page.waitForTimeout(4000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    // Extract communities from page - Shea uses window.moreInfoFormConfig or DOM cards
    const communities = await page.evaluate(() => {
      // Try window config first
      const win = window as any
      if (win.moreInfoFormConfig?.communitiesByRegion) {
        const allComms: { name: string; url: string; city: string }[] = []
        const regions = win.moreInfoFormConfig.communitiesByRegion
        for (const region of Object.values(regions) as any[]) {
          for (const comm of (region.communities || [])) {
            if (/orange/i.test(comm.region || "") || /orange/i.test(comm.county || "")) {
              allComms.push({ name: comm.name, url: comm.url || "", city: comm.city || "" })
            }
          }
        }
        if (allComms.length) return allComms
      }

      // Fall back to DOM cards
      const results: { name: string; url: string; city: string }[] = []
      const seen = new Set<string>()
      document.querySelectorAll("#community-market-area-listing a, .community-card a, a[href*='/community/']").forEach((a) => {
        const href = (a as HTMLAnchorElement).href
        if (!href || seen.has(href)) return
        seen.add(href)
        const card = a.closest("article, li, [class*='card']") || a
        const nameEl = card.querySelector("h2, h3, h4") as HTMLElement | null
        const name = nameEl?.innerText?.trim() || (a as HTMLElement).innerText?.trim() || ""
        if (!name) return
        const text = (card as HTMLElement).innerText || ""
        const cityM = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)
        results.push({ name, url: href, city: cityM?.[1] || "" })
      })
      return results
    })

    console.log(`Found ${communities.length} Shea Homes OC communities`)

    for (const comm of communities) {
      if (!comm.url) continue
      console.log(`  Scraping Shea: ${comm.name}`)
      try {
        const fullUrl = comm.url.startsWith("http") ? comm.url : `https://www.sheahomes.com${comm.url}`
        await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
        await page.waitForTimeout(3000)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(1500)

        const data = await page.evaluate((url) => {
          const body = (document.body as HTMLElement).innerText || ""
          const results: { address: string; price?: number; beds?: number; baths?: number; sqft?: number; floorPlan?: string; moveInDate?: string; sourceUrl: string }[] = []

          // Individual home cards
          const cards = document.querySelectorAll("[class*='homesite'], [class*='lot-card'], [class*='quick-move'], [class*='qmi']")
          cards.forEach((card) => {
            const el = card as HTMLElement
            const text = el.innerText || ""
            if (text.length < 10) return
            const priceM = text.match(/\$\s*([\d,]+)/)
            const bedM = text.match(/(\d+)\s*(?:bd|bed)/i)
            const bathM = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath)/i)
            const sqftM = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf)/i)
            const addrEl = el.querySelector("[class*='address']") as HTMLElement | null
            const linkEl = el.querySelector("a") as HTMLAnchorElement | null
            results.push({
              address: addrEl?.innerText?.trim() || text.substring(0, 50).trim() || "Plan Available",
              price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              sourceUrl: linkEl?.href || url,
            })
          })

          if (results.length === 0) {
            const priceM = body.match(/(?:from|starting)\s*\$\s*([\d,]+)/i) || body.match(/\$\s*([\d,]+)/)
            const bedM = body.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:bed|BD)/i) || body.match(/(\d+)\s*(?:bed|BD)/i)
            const bathM = body.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:bath|BA)/i) || body.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA)/i)
            const sqftM = body.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*(?:sq\.?\s*ft|SF)/i) || body.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)
            results.push({
              address: (document.querySelector("h1") as HTMLElement)?.innerText?.trim() || "Plans Available",
              price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
              beds: bedM ? parseFloat(bedM[1]) : undefined,
              baths: bathM ? parseFloat(bathM[1]) : undefined,
              sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
              sourceUrl: url,
            })
          }
          return results
        }, fullUrl)

        for (const home of data) {
          const price = home.price && home.price > 100000 ? home.price : undefined
          allListings.push({
            communityName: comm.name,
            communityUrl: fullUrl,
            address: home.address,
            floorPlan: home.floorPlan,
            sqft: home.sqft,
            beds: home.beds,
            baths: home.baths,
            price,
            pricePerSqft: price && home.sqft ? Math.round(price / home.sqft) : undefined,
            propertyType: /townhome|townhouse|attached/i.test(comm.name) ? "Attached" : "Detached",
            moveInDate: home.moveInDate,
            sourceUrl: home.sourceUrl,
          })
        }
      } catch (err) {
        console.log(`  Error scraping Shea ${comm.name}:`, err)
      }
      await page.waitForTimeout(1000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}
