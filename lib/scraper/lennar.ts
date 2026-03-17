import { chromium, type Page } from "playwright"
import type { ScrapedListing } from "./toll-brothers"
import { parseFloors } from "./toll-brothers"

/**
 * Known Lennar Irvine plan name → floor count.
 * Plan names don't encode stories so we maintain a lookup table.
 * Add new plans here as they are discovered.
 */
const LENNAR_PLAN_FLOORS: Record<string, number> = {
  // Great Park Neighborhoods
  "isla":    3,
  "rhea":    3,
  "rhea 3":  3,
  "rhea 2":  3,
  "rhea 1":  3,
  "isla 1":  3,
  "isla 2":  3,
  "isla 3":  3,
}

function lennarPlanFloors(planName: string | undefined): number | undefined {
  if (!planName) return undefined
  const key = planName.toLowerCase().trim()
  if (LENNAR_PLAN_FLOORS[key] !== undefined) return LENNAR_PLAN_FLOORS[key]
  // Check if any key is a prefix of the plan name (e.g. "Rhea 3 Plan A")
  for (const [k, v] of Object.entries(LENNAR_PLAN_FLOORS)) {
    if (key.startsWith(k)) return v
  }
  return undefined
}

const BASE_URL = "https://www.lennar.com"
const IRVINE_URL = `${BASE_URL}/new-homes/california/orange-county/irvine`

function parsePrice(text: string | null | undefined): number | undefined {
  if (!text) return undefined
  const cleaned = text.replace(/[^0-9]/g, "")
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? undefined : n
}

function parseNumber(text: string): number | undefined {
  const cleaned = text.replace(/[^0-9.]/g, "")
  const n = parseFloat(cleaned)
  return isNaN(n) ? undefined : n
}

/** "4 bd" → 4, "3 ba" → 3, "2,206 ft²" → 2206 */
function parseMeta(items: string[]): { beds?: number; baths?: number; sqft?: number } {
  let beds: number | undefined
  let baths: number | undefined
  let halfBaths = 0
  let sqft: number | undefined

  for (const item of items) {
    const lower = item.toLowerCase()
    if (lower.includes("half ba")) {
      halfBaths = parseNumber(item) ?? 0
    } else if (lower.includes("bd") || lower.includes("bed")) {
      beds = parseNumber(item)
    } else if (lower.includes("ba") || lower.includes("bath")) {
      baths = parseNumber(item)
    } else if (lower.includes("ft") || lower.includes("sq")) {
      sqft = parseNumber(item)
    }
  }

  // Add half baths as 0.5 each
  if (baths != null && halfBaths > 0) {
    baths = baths + halfBaths * 0.5
  }

  return { beds, baths, sqft }
}

/** "912 Chinon Irvine, CA" → "912 Chinon" */
function cleanAddress(raw: string): string {
  // Step 1: remove ", CA" (or " CA") at end
  // Step 2: remove the trailing city word (e.g. "Irvine")
  return raw
    .replace(/,?\s*[A-Z]{2}$/, "")   // "912 Chinon Irvine"
    .replace(/\s+\S+$/, "")           // "912 Chinon"
    .trim()
}

/** "Homesite #0091" → "0091" */
function parseLotNumber(raw: string): string | undefined {
  const m = raw.match(/homesite\s*#?\s*(\w+)/i)
  return m ? m[1] : undefined
}

/** "Rhea 3 in Great Park Neighborhoods" → { planName, communityName } */
function parsePlanAndCommunity(description: string): { planName: string; communityName: string } {
  const m = description.match(/^(.+?)\s+in\s+(.+)$/i)
  if (m) return { planName: m[1].trim(), communityName: m[2].trim() }
  return { planName: "", communityName: description.trim() }
}

/** Extract community base URL from homesite URL */
function communityUrlFromHref(href: string): string {
  // href like /new-homes/california/orange-county/irvine/great-park-neighborhoods/sub/plan/id
  const parts = href.split("/")
  // Keep up to the community segment (index 5 from root, after city)
  // /new-homes/california/orange-county/irvine/<community>
  const communitySegmentIndex = 5
  if (parts.length > communitySegmentIndex) {
    return `${BASE_URL}/${parts.slice(1, communitySegmentIndex + 1).join("/")}`
  }
  return href
}

/** Visit a Lennar homesite detail page to extract floors, HOA, move-in date, and taxes */
async function scrapeLennarDetailPage(page: Page, url: string): Promise<{
  floors?: number
  hoaFees?: number
  taxes?: number
  moveInDate?: string
}> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(2000)

    return await page.evaluate(() => {
      const body = (document.body as HTMLElement).innerText || ""

      // --- Floors: count SlashMenu floor tabs ---
      const floorTabs = document.querySelectorAll('[class*="SlashMenu_label"]')
      const floors = floorTabs.length > 0 ? floorTabs.length : undefined

      // --- Move-in date ---
      let moveInDate: string | undefined
      const m = body.match(/Available\s+(\d{1,2}\/\d{4})/i)
      if (m) moveInDate = `Available ${m[1]}`
      else if (/quick\s*move[-\s]?in/i.test(body)) moveInDate = "Quick Move-In"
      else if (/move[-\s]?in\s*ready/i.test(body)) moveInDate = "Move-In Ready"
      // Also check dedicated date elements
      const dateEl = document.querySelector('[class*="Availability_label"], [class*="moveIn"], [class*="availability"]') as HTMLElement | null
      if (!moveInDate && dateEl?.innerText?.trim()) moveInDate = dateEl.innerText.trim()

      // --- HOA ---
      let hoaFees: number | undefined
      const hoaPatterns = [
        /HOA\s*(?:Fee|Dues|Fees)?\s*:?\s*\$\s*([\d,]+)/i,
        /\$\s*([\d,]+)\s*\/\s*(?:mo\.?|month)\s*HOA/i,
        /Monthly\s+(?:HOA|Association)\s*(?:Fee)?\s*:?\s*\$\s*([\d,]+)/i,
        /Association\s+(?:Fee|Dues)\s*:?\s*\$\s*([\d,]+)/i,
        /Community\s+(?:Fee|Dues)\s*:?\s*\$\s*([\d,]+)/i,
      ]
      for (const pat of hoaPatterns) {
        const hm = body.match(pat)
        if (hm) { const n = parseInt(hm[1].replace(/,/g, ""), 10); if (!isNaN(n) && n > 0 && n < 5000) { hoaFees = n; break } }
      }

      // --- Taxes ---
      let taxes: number | undefined
      const taxPatterns = [
        /(?:Property\s+)?Tax(?:es)?\s*:?\s*\$\s*([\d,]+)\s*\/\s*(?:mo|month)/i,
        /\$\s*([\d,]+)\s*\/\s*(?:mo|month)\s*(?:in\s+)?tax/i,
        /Mello[- ]Roos\s*:?\s*\$\s*([\d,]+)/i,
        /CFD\s*:?\s*\$\s*([\d,]+)/i,
      ]
      for (const pat of taxPatterns) {
        const tm = body.match(pat)
        if (tm) { const n = parseInt(tm[1].replace(/,/g, ""), 10); if (!isNaN(n) && n > 0 && n < 50000) { taxes = n; break } }
      }

      return { floors, hoaFees, taxes, moveInDate: moveInDate || undefined }
    })
  } catch {
    return {}
  }
}

export async function scrapeLennarIrvine(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })

  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Loading Lennar Irvine page...")
    await page.goto(IRVINE_URL, { waitUntil: "domcontentloaded", timeout: 90000 })

    // Wait for homesite cards to appear
    await page.waitForSelector('[class*="HomesiteCard_link"]', { timeout: 30000 }).catch(() => {
      console.log("HomesiteCard_link selector not found, trying fallback wait...")
    })
    await page.waitForTimeout(3000)

    // Scroll to bottom to trigger lazy-loaded cards
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(2000)

    const rawCards = await page.evaluate(() => {
      const results: Array<{
        href: string
        priceText: string
        metaItems: string[]
        addressText: string
        lotText: string
        descriptionText: string
        statusText: string
      }> = []

      document.querySelectorAll('[class*="HomesiteCard_link"]').forEach((card) => {
        const href = (card as HTMLAnchorElement).href || ""
        if (!href) return

        const metaItems = Array.from(
          card.querySelectorAll('[class*="MetaDetails_baseItem"]')
        ).map((e) => (e as HTMLElement).innerText?.trim() || "")

        results.push({
          href,
          priceText: (card.querySelector('[class*="headline4New"]') as HTMLElement)?.innerText?.trim() || "",
          metaItems,
          addressText: (card.querySelector('[class*="HomesiteCard_addressWrapper"]') as HTMLElement)?.innerText?.trim() || "",
          lotText: (card.querySelector('[class*="HomesiteCard_lotId"]') as HTMLElement)?.innerText?.trim() || "",
          descriptionText: (card.querySelector('[class*="HomesiteCard_newDescription"]') as HTMLElement)?.innerText?.trim() || "",
          statusText: (card.querySelector('[class*="Availability_label"]') as HTMLElement)?.innerText?.trim() || "",
        })
      })

      return results
    })

    console.log(`Found ${rawCards.length} Lennar Irvine listings`)

    for (const raw of rawCards) {
      const { planName, communityName } = parsePlanAndCommunity(raw.descriptionText)
      if (!communityName || !raw.addressText) continue

      const { beds, baths, sqft } = parseMeta(raw.metaItems)
      const price = parsePrice(raw.priceText)
      const address = cleanAddress(raw.addressText)
      if (!address) continue

      // Card-level status text
      const statusLower = raw.statusText.toLowerCase()
      let moveInDate: string | undefined =
        statusLower.includes("move-in") || statusLower.includes("quick") || statusLower.includes("ready")
          ? raw.statusText
          : undefined

      // Visit detail page to get floors, HOA, taxes, and specific move-in date
      let detailFloors: number | undefined
      let detailHoa: number | undefined
      let detailTaxes: number | undefined
      if (raw.href) {
        console.log(`  Fetching Lennar detail: ${raw.href}`)
        const detail = await scrapeLennarDetailPage(page, raw.href)
        detailFloors = detail.floors
        detailHoa = detail.hoaFees
        detailTaxes = detail.taxes
        moveInDate = moveInDate || detail.moveInDate
        await page.waitForTimeout(800)
      }

      allListings.push({
        communityName,
        communityUrl: communityUrlFromHref(raw.href),
        address,
        lotNumber: parseLotNumber(raw.lotText),
        floorPlan: planName || undefined,
        sqft,
        beds,
        baths,
        garages: undefined,
        floors: lennarPlanFloors(planName) ?? detailFloors ?? parseFloors(planName),
        price,
        pricePerSqft: price && sqft ? Math.round(price / sqft) : undefined,
        hoaFees: detailHoa,
        taxes: detailTaxes,
        moveInDate,
        schools: undefined,
        incentives: undefined,
        sourceUrl: raw.href,
      })
    }
  } finally {
    await browser.close()
  }

  return allListings
}
