/**
 * Brookfield Residential scraper.
 * Next.js + Sitecore CMS. Community data is in __NEXT_DATA__ JSON.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.brookfieldresidential.com/new-homes/california/orange-county"

export async function scrapeBrookfieldOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Brookfield Residential OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(3000)

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; status?: string }[] = []

      // Try __NEXT_DATA__ first
      const nextDataEl = document.getElementById("__NEXT_DATA__")
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent || "{}")
          const componentProps = data?.props?.pageProps?.componentProps || {}

          // Iterate all component keys to find the one with results[]
          for (const key of Object.keys(componentProps)) {
            const comp = componentProps[key]
            const items = comp?.props?.results || comp?.results || []
            if (Array.isArray(items) && items.length > 0) {
              items.forEach((c: any) => {
                const url = c.community_url ? `https://www.brookfieldresidential.com${c.community_url}` : ""
                results.push({
                  name: c.community_name || c.name || "",
                  url,
                  city: c.community_city || c.city || "",
                  price: c.minimumprice || c.displayprice || undefined,
                  beds: c.minimumresidencebedrooms || undefined,
                  baths: c.minimumtotalbaths || undefined,
                  sqft: c.minimumsquarefootage || undefined,
                  status: c.community_status || "",
                })
              })
              if (results.length > 0) break
            }
          }
        } catch {}
      }

      // Fallback to DOM
      if (results.length === 0) {
        document.querySelectorAll("[class*='CommCard_cardStyles'], [class*='community-card'], article").forEach((card) => {
          const el = card as HTMLElement
          const nameEl = el.querySelector("h2, h3, [class*='name'], [class*='title']") as HTMLElement | null
          const name = nameEl?.innerText?.trim() || ""
          if (!name) return

          const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null
          const url = linkEl?.href || ""

          const text = el.innerText || ""
          const priceM = text.match(/\$\s*([\d,]+)/)
          const cityM = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*CA/)
          const bedM = text.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:bed|BD)/i) || text.match(/(\d+)\s*(?:bed|BD)/i)
          const bathM = text.match(/(\d+(?:\.\d+)?)\s*[-–]\s*[\d.]+\s*(?:bath|BA)/i) || text.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA)/i)
          const sqftM = text.match(/([\d,]+)\s*[-–]\s*([\d,]+)\s*(?:sq\.?\s*ft|SF)/i) || text.match(/([\d,]+)\s*(?:sq\.?\s*ft|SF)/i)

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
      }

      return results
    })

    // Filter out sold out communities
    const active = communities.filter((c) => !/sold.?out|temporarily/i.test(c.status || ""))
    console.log(`Found ${active.length} active Brookfield OC communities (${communities.length} total)`)

    for (const comm of active) {
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
