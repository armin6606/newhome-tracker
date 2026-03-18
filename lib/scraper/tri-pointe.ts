/**
 * TRI Pointe Homes scraper.
 * OC page: https://www.tripointehomes.com/ca/orange-county/
 * Uses [class*="container-listing"] cards (move-in ready + community entries).
 */
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
    await page.waitForTimeout(5000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const cards = await page.evaluate(() => {
      const results: {
        address: string; href: string; price?: number; beds?: number
        baths?: number; sqft?: number; communityName?: string; status?: string
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

        results.push({
          address: addrLine || lines[1] || "Plan Available",
          href,
          price: price && price > 100000 ? price : undefined,
          beds: bedM ? parseFloat(bedM[1]) : undefined,
          baths: bathM ? parseFloat(bathM[1]) : undefined,
          sqft: sqftM ? parseInt(sqftM[1].replace(/,/g, ""), 10) : undefined,
          communityName: commM?.[1]?.trim().split("\n")[0],
          status: /move.in.ready/i.test(lines[0] || "") ? "Move-In Ready" : undefined,
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
