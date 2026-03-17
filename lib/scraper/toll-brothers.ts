import { chromium, type Page } from "playwright"

export interface ScrapedListing {
  communityName: string
  communityUrl: string
  address: string
  lotNumber?: string
  floorPlan?: string
  sqft?: number
  beds?: number
  baths?: number
  garages?: number
  floors?: number
  price?: number
  pricePerSqft?: number
  hoaFees?: number
  moveInDate?: string
  schools?: string
  incentives?: string
  sourceUrl: string
}

/** Parse floor count from plan name: "Plan 1 - 2 Story" → 2, "3-Story" → 3 */
export function parseFloors(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const m = text.match(/(\d)\s*[-–]?\s*stor(?:y|ies)/i)
  return m ? parseInt(m[1], 10) : undefined
}

const BASE_URL = "https://www.tollbrothers.com"
const CALIFORNIA_INDEX_URL = `${BASE_URL}/luxury-homes/California`


function parsePrice(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const cleaned = text.replace(/[^0-9]/g, "")
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? undefined : n
}

/**
 * Parse the modelDetails block:
 * "5\n\nBedrooms\n\n5\n\nBaths\n\n3,411\n\nSquare Feet\n\n0\n\nHalf Bath\n\n2\n\nGarages"
 */
function parseModelDetails(text: string | null | undefined) {
  if (!text) return {}
  const tokens = text.split(/\n\n/).map((t) => t.trim()).filter(Boolean)
  let beds: number | undefined
  let baths: number | undefined
  let sqft: number | undefined
  let garages: number | undefined
  let floors: number | undefined

  for (let i = 0; i < tokens.length - 1; i++) {
    const n = parseFloat(tokens[i].replace(/,/g, ""))
    if (isNaN(n)) continue
    const label = tokens[i + 1].toLowerCase()
    if (label === "bedrooms" || label === "beds") beds = n
    else if (label === "baths" || label === "bathrooms") baths = n
    else if (label === "square feet" || label === "sq ft" || label === "sqft" || label === "square footage") sqft = n
    else if (label === "garages" || label === "garage") garages = n
    else if (label === "stories" || label === "story" || label === "floors" || label === "floor") floors = n
  }

  return { beds, baths, sqft, garages, floors }
}

/** Visit an individual homesite detail page and extract the availability/move-in date */
async function scrapeDetailDate(page: Page, url: string): Promise<string | undefined> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(1500)

    const date = await page.evaluate(() => {
      // Try known class fragments first
      const selectors = [
        '[class*="qmiDate"]',
        '[class*="deliveryDate"]',
        '[class*="EstimatedDelivery"]',
        '[class*="availability"]',
        '[class*="moveIn"]',
        '[class*="move-in"]',
        '[class*="availableDate"]',
        '[class*="homesiteDate"]',
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        const txt = el?.innerText?.trim()
        if (txt && txt.length > 2) return txt
      }

      // Fallback: scan visible text for "Available M/YYYY" or "Quick Move-In"
      const body = (document.body as HTMLElement).innerText || ""
      const m = body.match(/Available\s+(\d{1,2}\/\d{4})/i)
      if (m) return `Available ${m[1]}`
      if (/quick\s*move[-\s]?in/i.test(body)) return "Quick Move-In"

      return null
    })

    return date || undefined
  } catch {
    return undefined
  }
}

export async function scrapeTollBrothersIrvine(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Finding Irvine communities from California index...")

    await page.goto(CALIFORNIA_INDEX_URL, { waitUntil: "networkidle", timeout: 60000 })

    // Find all community links where the card itself contains "Irvine" (tight check)
    const rawLinks: { name: string; url: string }[] = await page.evaluate(() => {
      const results: { name: string; url: string }[] = []
      const seen = new Set<string>()

      document
        .querySelectorAll('[class*="SearchProductCard_master"] a[href*="/luxury-homes-for-sale/California/"]')
        .forEach((a) => {
          const href = (a as HTMLAnchorElement).href
          if (!href || seen.has(href) || href.includes("#")) return

          const card = a.closest('[class*="SearchProductCard_master"]')
          if (!card || !card.textContent?.includes("Irvine")) return

          seen.add(href)
          results.push({ name: (a.textContent || "").trim(), url: href })
        })

      return results
    })

    // rawLinks are already deduplicated by URL in the evaluate call
    const communityLinks = rawLinks

    console.log(`Found ${communityLinks.length} Irvine community links`)

    for (const community of communityLinks) {
      console.log(`Scraping: ${community.name}`)
      try {
        const listings = await scrapeCommunityPage(page, community.name, community.url)
        allListings.push(...listings)
        console.log(`  → ${listings.length} listings`)
      } catch (err) {
        console.error(`Error scraping ${community.name}:`, err)
      }
      await page.waitForTimeout(2000)
    }
  } finally {
    await browser.close()
  }

  return allListings
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

async function scrapeCommunityPage(
  page: Page,
  communityName: string,
  communityUrl: string
): Promise<ScrapedListing[]> {
  await page.goto(communityUrl, { waitUntil: "networkidle", timeout: 60000 })

  // Extract real community name from h1
  const h1Text = await page.evaluate(() => document.querySelector("h1")?.innerText?.trim() || "")
  const realName = h1Text ? toTitleCase(h1Text) : communityName

  // Try clicking a QMI / Available Homes tab
  for (const tabText of ["Quick Move-In", "Available Homes", "Move-In Ready"]) {
    try {
      const tab = page.locator(`a:has-text('${tabText}'), button:has-text('${tabText}')`)
      if (await tab.first().isVisible({ timeout: 2000 })) {
        await tab.first().click()
        await page.waitForTimeout(2000)
        break
      }
    } catch {
      // tab not found, continue
    }
  }

  // Use a plain function string to avoid esbuild __name injection
  const rawCards = await page.evaluate(
    ([cName, cUrl]: [string, string]) => { // eslint-disable-line
      const results: Array<{
        communityName: string
        communityUrl: string
        addressRaw: string
        planName: string
        detailsText: string
        priceText: string
        moveInDate: string
        sourceUrl: string
      }> = []

      document.querySelectorAll('[class*="ModelCard_modelCardContainer"]').forEach((card) => {
        // inline helpers — no named const assignment to avoid __name
        const addressRaw =
          ((card.querySelector('[class*="calloutAddressWrapper"]') as HTMLElement)?.innerText?.trim()) ||
          ((card.querySelector('[class*="address"]') as HTMLElement)?.innerText?.trim()) ||
          ((card.querySelector("h2, h3") as HTMLElement)?.innerText?.trim()) ||
          ""

        if (!addressRaw || addressRaw.length < 3) return

        const linkEl: HTMLAnchorElement | null =
          card.tagName === "A"
            ? (card as HTMLAnchorElement)
            : (card.querySelector("a") as HTMLAnchorElement | null)

        const priceEl = card.querySelector('[class*="price__adjust"]') as HTMLElement | null
        const priceElFallback = card.querySelector('[class*="ModelCard_modelPrice"]') as HTMLElement | null

        results.push({
          communityName: cName,
          communityUrl: cUrl,
          addressRaw,
          planName: ((card.querySelector('[class*="ModelCard_modelName"]') as HTMLElement)?.innerText?.trim()) || "",
          detailsText: ((card.querySelector('[class*="modelDetails"]') as HTMLElement)?.innerText?.trim()) || "",
          priceText: (priceEl?.innerText?.trim()) || (priceElFallback?.innerText?.trim()) || "",
          moveInDate: (
            ((card.querySelector('[class*="qmiDate"]') as HTMLElement)?.innerText?.trim()) ||
            ((card.querySelector('[class*="moveInDate"]') as HTMLElement)?.innerText?.trim()) ||
            ((card.querySelector('[class*="deliveryDate"]') as HTMLElement)?.innerText?.trim()) ||
            ((card.querySelector('[class*="EstimatedDelivery"]') as HTMLElement)?.innerText?.trim()) ||
            ((card.querySelector('[class*="availability"]') as HTMLElement)?.innerText?.trim()) ||
            ""
          ),
          sourceUrl: linkEl?.href || cUrl,
        })
      })

      return results
    },
    [realName, communityUrl] as [string, string]
  )

  const listings: ScrapedListing[] = []

  for (const raw of rawCards) {
    // "Home Site 35 | 136 Creation" → lot + street
    const parts = raw.addressRaw.split(/\s*\|\s*/)
    const lotNumber = parts.length > 1 ? parts[0].trim() : undefined
    const address = parts.length > 1 ? parts[1].trim() : raw.addressRaw.trim()

    const { beds, baths, sqft, garages, floors: floorsFromDetails } = parseModelDetails(raw.detailsText)
    const price = parsePrice(raw.priceText)

    // If the community card didn't give us a date, visit the detail page to find it
    let moveInDate = raw.moveInDate || undefined
    if (!moveInDate && raw.sourceUrl && raw.sourceUrl !== communityUrl) {
      console.log(`    Fetching detail date: ${raw.sourceUrl}`)
      moveInDate = await scrapeDetailDate(page, raw.sourceUrl)
      await page.waitForTimeout(800)
    }

    listings.push({
      communityName: raw.communityName,
      communityUrl: raw.communityUrl,
      address,
      lotNumber,
      floorPlan: raw.planName || undefined,
      beds,
      baths,
      sqft,
      garages,
      floors: floorsFromDetails ?? parseFloors(raw.planName),
      price,
      pricePerSqft: price && sqft ? Math.round(price / sqft) : undefined,
      moveInDate,
      sourceUrl: raw.sourceUrl,
    })
  }

  return listings
}
