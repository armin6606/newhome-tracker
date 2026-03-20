/**
 * Brookfield Residential scraper.
 * Next.js + Sitecore CMS. Community data is in __NEXT_DATA__ JSON.
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"
import { randomDelayMs, randomUserAgent } from "./utils"

const OC_URL = "https://www.brookfieldresidential.com/new-homes/california/orange-county"
const PROMOS_URLS = [
  "https://www.brookfieldresidential.com/promotions",
  "https://www.brookfieldresidential.com/offers",
  "https://www.brookfieldresidential.com/special-offers",
  "https://www.brookfieldresidential.com/incentives",
]

/** Scrape Brookfield Residential builder-wide promotions page for offer details */
async function scrapeBrookfieldPromotions(page: import("playwright").Page): Promise<string | undefined> {
  for (const promoUrl of PROMOS_URLS) {
    try {
      console.log(`  Trying Brookfield promotions page: ${promoUrl}`)
      const response = await page.goto(promoUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      if (!response || response.status() >= 400) continue
      await page.waitForTimeout(randomDelayMs(2000, 4000))

      const result = await page.evaluate(() => {
        const body = document.body as HTMLElement
        const bodyText = body.innerText || ""

        // Try Next.js __NEXT_DATA__ for structured promotion data
        const nextDataEl = document.getElementById("__NEXT_DATA__")
        if (nextDataEl) {
          try {
            const data = JSON.parse(nextDataEl.textContent || "{}")
            const pageProps = data?.props?.pageProps || {}
            // Look for promotion content in various possible locations
            const promoText = pageProps?.promotionText || pageProps?.offerText ||
              pageProps?.incentiveText || pageProps?.heroText || pageProps?.description
            if (promoText && typeof promoText === "string" && promoText.length > 10) {
              return promoText.substring(0, 500)
            }
          } catch { /* ignore parse errors */ }
        }

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

export async function scrapeBrookfieldOC(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Brookfield Residential OC page...")
    await page.goto(OC_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    const communities = await page.evaluate(() => {
      const results: { name: string; url: string; city: string; price?: number; beds?: number; baths?: number; sqft?: number; status?: string; incentives?: string }[] = []

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

                // Extract incentive data from API response if available
                const incentiveParts = [
                  c.incentive, c.incentiveText, c.promotion,
                  c.promotionText, c.specialOffer, c.promoLabel,
                  c.community_incentive, c.community_promotion,
                ].filter(Boolean) as string[]
                const incentives = incentiveParts.length > 0 ? incentiveParts.join(" | ").trim() : undefined

                results.push({
                  name: c.community_name || c.name || "",
                  url,
                  city: c.community_city || c.city || "",
                  price: c.minimumprice || c.displayprice || undefined,
                  beds: c.minimumresidencebedrooms || undefined,
                  baths: c.minimumtotalbaths || undefined,
                  sqft: c.minimumsquarefootage || undefined,
                  status: c.community_status || "",
                  incentives,
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

          // Check for incentive elements in DOM card
          let incentives: string | undefined
          const incentiveSelectors = [
            '[class*="incentive"]', '[class*="Incentive"]',
            '[class*="promotion"]', '[class*="Promotion"]',
            '[class*="offer"]', '[class*="Offer"]',
            '[class*="special"]', '[class*="Special"]',
            '[class*="closing"]', '[class*="buydown"]',
            '[class*="credit"]', '[class*="Credit"]',
            '[class*="savings"]', '[class*="Savings"]',
          ]
          for (const sel of incentiveSelectors) {
            const incEl = el.querySelector(sel) as HTMLElement | null
            const txt = incEl?.innerText?.trim()
            if (txt && txt.length > 5 && txt.length < 500) { incentives = txt; break }
          }

          // Regex fallback on card text
          if (!incentives) {
            const incPatterns = [
              /(?:closing\s+cost\s+(?:credit|assistance)|rate\s+buy[-\s]?down|flex\s+cash|design\s+(?:credit|dollars?)|upgrade\s+credit|builder\s+incentive|special\s+offer|limited[-\s]time\s+offer)\s*[:\-–]?\s*([^\n.]{5,120})/gi,
            ]
            const matches: string[] = []
            for (const pat of incPatterns) {
              let m: RegExpExecArray | null
              while ((m = pat.exec(text)) !== null) {
                matches.push(m[0].trim())
                if (matches.length >= 3) break
              }
            }
            if (matches.length) incentives = matches.join(" | ")
          }

          results.push({
            name,
            url,
            city: cityM?.[1] || "",
            price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined,
            beds: bedM ? parseFloat(bedM[1]) : undefined,
            baths: bathM ? parseFloat(bathM[1]) : undefined,
            sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
            incentives,
          })
        })
      }

      return results
    })

    // Scrape builder-wide promotions page
    const builderPromo = await scrapeBrookfieldPromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }

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
        incentives: comm.incentives || builderPromo,
        sourceUrl: comm.url || OC_URL,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
