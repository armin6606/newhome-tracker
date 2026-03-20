/**
 * TRI Pointe Homes scraper.
 * OC page: https://www.tripointehomes.com/ca/orange-county/
 * Uses [class*="container-listing"] cards (move-in ready + community entries).
 */
import { chromium } from "playwright"
import type { ScrapedListing } from "./toll-brothers"

const OC_URL = "https://www.tripointehomes.com/ca/orange-county/"
const PROMOS_URLS = [
  "https://www.tripointehomes.com/special-offers/",
  "https://www.tripointehomes.com/offers/",
  "https://www.tripointehomes.com/promotions/",
]

/** Scrape TRI Pointe builder-wide promotions page for offer details */
async function scrapeTriPointePromotions(page: import("playwright").Page): Promise<string | undefined> {
  for (const promoUrl of PROMOS_URLS) {
    try {
      console.log(`  Trying TRI Pointe promotions page: ${promoUrl}`)
      const response = await page.goto(promoUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      if (!response || response.status() >= 400) continue
      await page.waitForTimeout(3000)

      const result = await page.evaluate(() => {
        const body = document.body as HTMLElement
        const bodyText = body.innerText || ""

        const promoSelectors = [
          '[class*="promo"]', '[class*="Promo"]',
          '[class*="offer"]', '[class*="Offer"]',
          '[class*="incentive"]', '[class*="Incentive"]',
          '[class*="savings"]', '[class*="Savings"]',
          '[class*="hero"] h1', '[class*="hero"] h2',
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
    await page.waitForTimeout(5000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const cards = await page.evaluate(() => {
      const results: {
        address: string; href: string; price?: number; beds?: number
        baths?: number; sqft?: number; communityName?: string; status?: string
        incentives?: string
      }[] = []

      document.querySelectorAll('[class*="container-listing"]').forEach((el) => {
        const text = (el as HTMLElement).innerText || ""
        if (text.length > 600) return // skip the page-level container

        const linkEl = el.querySelector("a[href]") as HTMLAnchorElement | null
        const href = linkEl?.href || ""

        const priceM = text.match(/\$([\d,]+)/)
        const price = priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : undefined
        const bedM = text.match(/(\d+)\s*Beds?/i)
        const bathM = text.match(/([\d.]+)\s*Baths?/i)
        const sqftM = text.match(/([\d,]+)\s*Sq\.?\s*Ft/i)
        const commM = text.match(/In\s+(.+)/im)
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
        const addrLine = lines.find((l) => /^\d+\s+[A-Z]/.test(l))

        if (!href && !addrLine) return

        // Check for incentive text within the card
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
          address: addrLine || lines[1] || "Plan Available",
          href,
          price: price && price > 100000 ? price : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          communityName: commM?.[1]?.trim().split("\n")[0],
          status: /move.in.ready/i.test(lines[0] || "") ? "Move-In Ready" : undefined,
          incentives,
        })
      })

      return results
    })

    // Get community-level entries too
    const communities = await page.evaluate((baseUrl) => {
      const results: { name: string; url: string }[] = []
      const seen = new Set<string>()
      document.querySelectorAll('a[href*="/ca/orange-county/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href
        const segments = href.replace(baseUrl, "").split("/").filter(Boolean)
        // Community root = exactly 2 segments (state + community slug)
        if (!href || seen.has(href) || segments.length !== 2) return
        seen.add(href)
        const name = (a as HTMLElement).innerText?.trim() || ""
        if (!name || name.length > 80) return
        results.push({ name, url: href })
      })
      return results
    }, OC_URL)

    console.log(`Found ${cards.length} TRI Pointe MIR listings, ${communities.length} communities`)

    // Scrape builder-wide promotions page
    const builderPromo = await scrapeTriPointePromotions(page)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
    }
    const pageIncentives = builderPromo

    for (const card of cards) {
      const communityName = card.communityName || "TRI Pointe OC"
      const communityUrl = card.href ? card.href.split("/").slice(0, 7).join("/") : OC_URL
      allListings.push({
        communityName,
        communityUrl,
        address: card.address,
        sqft: card.sqft,
        beds: card.beds,
        baths: card.baths,
        price: card.price,
        pricePerSqft: card.price && card.sqft ? Math.round(card.price / card.sqft) : undefined,
        propertyType: "Detached",
        moveInDate: card.status,
        incentives: card.incentives || pageIncentives,
        sourceUrl: card.href || OC_URL,
      })
    }

    const coveredUrls = new Set(allListings.map((l) => l.communityUrl))
    for (const comm of communities) {
      if (!coveredUrls.has(comm.url)) {
        allListings.push({
          communityName: comm.name,
          communityUrl: comm.url,
          address: `${comm.name} - Plans Available`,
          propertyType: "Detached",
          sourceUrl: comm.url,
        })
      }
    }
  } finally {
    await browser.close()
  }

  return allListings
}
