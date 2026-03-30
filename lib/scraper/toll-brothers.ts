import { chromium, type Page } from "playwright"
import { randomDelayMs, randomUserAgent } from "./utils"

export interface ScrapedListing {
  communityName: string
  communityUrl: string
  city?: string
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
  propertyType?: string
  hoaFees?: number
  taxes?: number
  moveInDate?: string
  schools?: string
  incentives?: string
  sourceUrl: string
  status?: string   // "active" | "sold" | "future" — defaults to "active" if omitted
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

/** Visit an individual homesite detail page and extract date, HOA, taxes, floors, and incentives */
async function scrapeDetailPage(page: Page, url: string): Promise<{
  moveInDate?: string
  hoaFees?: number
  taxes?: number
  floors?: number
  incentives?: string
}> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(randomDelayMs(1000, 2500))

    return await page.evaluate(() => {
      const body = (document.body as HTMLElement).innerText || ""

      // --- Move-in date ---
      let moveInDate: string | undefined
      const dateSelectors = [
        '[class*="qmiDate"]', '[class*="deliveryDate"]', '[class*="EstimatedDelivery"]',
        '[class*="availability"]', '[class*="moveIn"]', '[class*="move-in"]',
        '[class*="availableDate"]', '[class*="homesiteDate"]',
      ]
      for (const sel of dateSelectors) {
        const txt = (document.querySelector(sel) as HTMLElement)?.innerText?.trim()
        if (txt && txt.length > 2) {
          // Strip "Quick Move-In " prefix, keep just the date or status
          moveInDate = txt.replace(/^quick\s+move[-\s]?in\s*/i, "").trim() || txt
          break
        }
      }
      if (!moveInDate) {
        const m = body.match(/(?:quick\s+move[-\s]?in\s+)?(\d{1,2}\/\d{4})/i)
        if (m) moveInDate = m[1]
        else if (/move[-\s]?in\s*ready/i.test(body)) moveInDate = "Move-In Ready"
      }

      // --- HOA ---
      let hoaFees: number | undefined
      const hoaPatterns = [
        /HOA\s*(?:Fee|Dues|Fees|Assessment)?\s*:?\s*\$\s*([\d,]+)/i,
        /\$\s*([\d,]+)\s*\/\s*(?:mo\.?|month)\s*HOA/i,
        /Monthly\s+(?:HOA|Association)\s*(?:Fee|Dues)?\s*:?\s*\$\s*([\d,]+)/i,
        /Association\s+(?:Fee|Dues)\s*:?\s*\$\s*([\d,]+)/i,
        /Homeowners?\s+Association\s*:?\s*\$\s*([\d,]+)/i,
      ]
      for (const pat of hoaPatterns) {
        const m = body.match(pat)
        if (m) { const n = parseInt(m[1].replace(/,/g, ""), 10); if (!isNaN(n) && n > 0 && n < 5000) { hoaFees = n; break } }
      }

      // --- Taxes ---
      let taxes: number | undefined
      const taxPatterns = [
        /(?:Property\s+)?Tax(?:es)?\s*:?\s*\$\s*([\d,]+)\s*\/\s*(?:mo|month)/i,
        /\$\s*([\d,]+)\s*\/\s*(?:mo|month)\s*(?:in\s+)?tax/i,
        /Mello[- ]Roos\s*:?\s*\$\s*([\d,]+)/i,
        /CFD\s*:?\s*\$\s*([\d,]+)/i,
        /Est(?:imated)?\s+(?:Annual\s+)?Tax(?:es)?\s*:?\s*\$\s*([\d,]+)/i,
      ]
      for (const pat of taxPatterns) {
        const m = body.match(pat)
        if (m) { const n = parseInt(m[1].replace(/,/g, ""), 10); if (!isNaN(n) && n > 0 && n < 50000) { taxes = n; break } }
      }

      // --- Floors from model details block ---
      let floors: number | undefined
      const detailEls = document.querySelectorAll('[class*="modelDetails"] [class*="modelDetail"], [class*="ModelCard_modelNumber"], [class*="ModelCard_modelUnit"]')
      const tokens = Array.from(detailEls).map((e) => (e as HTMLElement).innerText?.trim()).filter(Boolean)
      for (let i = 0; i < tokens.length - 1; i++) {
        const label = tokens[i + 1].toLowerCase()
        if (label === "stories" || label === "story" || label === "floors") {
          const n = parseInt(tokens[i].replace(/,/g, ""), 10)
          if (!isNaN(n)) { floors = n; break }
        }
      }

      // --- Incentives ---
      let incentives: string | undefined
      const incentiveSelectors = [
        '[class*="incentive"]', '[class*="Incentive"]',
        '[class*="promotion"]', '[class*="Promotion"]',
        '[class*="offer"]', '[class*="Offer"]',
        '[class*="special"]', '[class*="Special"]',
        '[class*="closing"]', '[class*="buydown"]',
        '[class*="credit"]', '[class*="Credit"]',
      ]
      for (const sel of incentiveSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        const txt = el?.innerText?.trim()
        if (txt && txt.length > 5 && txt.length < 500) { incentives = txt; break }
      }
      if (!incentives) {
        const patterns = [
          /(?:closing\s+cost\s+(?:credit|assistance)|rate\s+buy[- ]?down|flex\s+cash|design\s+(?:credit|dollars?)|upgrade\s+credit|builder\s+incentive|special\s+offer|limited[\s-]time\s+offer)\s*[:\-–]?\s*([^\n.]{5,120})/gi,
        ]
        const matches: string[] = []
        for (const pat of patterns) {
          let m: RegExpExecArray | null
          while ((m = pat.exec(body)) !== null) {
            matches.push(m[0].trim())
            if (matches.length >= 3) break
          }
        }
        if (matches.length) incentives = matches.join(" · ")
      }

      return { moveInDate: moveInDate || undefined, hoaFees, taxes, floors, incentives }
    })
  } catch {
    return {}
  }
}

const OC_CITIES = [
  "Irvine", "Newport Beach", "Laguna Niguel", "Laguna Beach", "Laguna Hills",
  "Mission Viejo", "Lake Forest", "Rancho Santa Margarita", "San Clemente",
  "San Juan Capistrano", "Aliso Viejo", "Dana Point", "Tustin", "Orange",
  "Anaheim", "Yorba Linda", "Brea", "Placentia", "Fullerton", "Buena Park",
  "Huntington Beach", "Fountain Valley", "Westminster", "Garden Grove",
  "Santa Ana", "Seal Beach", "Los Alamitos", "Cypress", "Stanton", "La Habra",
  "Villa Park", "Rancho Mission Viejo",
]

export async function scrapeTollBrothersIrvine(): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
  })
  const allListings: ScrapedListing[] = []

  try {
    const page = await context.newPage()
    console.log("Finding Toll Brothers OC communities from California index...")

    await page.goto(CALIFORNIA_INDEX_URL, { waitUntil: "networkidle", timeout: 60000 })

    // Find all community links in any OC city
    const rawLinks: { name: string; url: string; propertyType: string }[] = await page.evaluate((ocCities) => {
      const results: { name: string; url: string; propertyType: string }[] = []
      const seen = new Set<string>()

      document
        .querySelectorAll('[class*="SearchProductCard_master"] a[href*="/luxury-homes-for-sale/California/"]')
        .forEach((a) => {
          const href = (a as HTMLAnchorElement).href
          if (!href || seen.has(href) || href.includes("#")) return

          const card = a.closest('[class*="SearchProductCard_master"]')
          if (!card) return
          const cardText = card.textContent || ""
          const isOC = ocCities.some((city: string) => cardText.includes(city))
          if (!isOC) return

          seen.add(href)
          const propertyType = /townhome|townhouse|attached/i.test(cardText) ? "Attached" : "Detached"
          results.push({ name: (a.textContent || "").trim(), url: href, propertyType })
        })

      return results
    }, OC_CITIES)

    // rawLinks are already deduplicated by URL in the evaluate call
    const communityLinks = rawLinks

    console.log(`Found ${communityLinks.length} Toll Brothers OC community links`)

    for (const community of communityLinks) {
      console.log(`Scraping: ${community.name}`)
      try {
        const listings = await scrapeCommunityPage(page, community.name, community.url, community.propertyType)
        allListings.push(...listings)
        console.log(`  → ${listings.length} listings`)
      } catch (err) {
        console.error(`Error scraping ${community.name}:`, err)
      }
      await page.waitForTimeout(randomDelayMs(1500, 3000))
    }
  } finally {
    await browser.close()
  }

  return allListings
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function scrapeCommunityPage(
  page: Page,
  communityName: string,
  communityUrl: string,
  propertyType = "Detached"
): Promise<ScrapedListing[]> {
  await page.goto(communityUrl, { waitUntil: "networkidle", timeout: 60000 })

  // Extract real community name from h1
  const h1Text = await page.evaluate(() => document.querySelector("h1")?.innerText?.trim() || "")
  const realName = h1Text ? toTitleCase(h1Text) : communityName

  // Extract community-level HOA from the page before clicking any tabs
  const communityHoa = await page.evaluate(() => {
    const body = (document.body as HTMLElement).innerText || ""
    const patterns = [
      /HOA\s*(?:Fee|Dues|Fees|Assessment)?\s*:?\s*\$\s*([\d,]+)/i,
      /\$\s*([\d,]+)\s*\/\s*(?:mo\.?|month)\s*HOA/i,
      /Monthly\s+(?:HOA|Association\s+Fee)\s*:?\s*\$\s*([\d,]+)/i,
      /Association\s+(?:Fee|Dues)\s*:?\s*\$\s*([\d,]+)/i,
      /Homeowners\s+Association\s*:?\s*\$\s*([\d,]+)/i,
    ]
    for (const pat of patterns) {
      const m = body.match(pat)
      if (m) {
        const n = parseInt(m[1].replace(/,/g, ""), 10)
        if (!isNaN(n) && n > 0 && n < 5000) return n
      }
    }
    // Also check any element whose class name contains "hoa" (case-insensitive)
    const els = document.querySelectorAll('[class*="hoa" i], [class*="monthlyFee" i], [class*="associationFee" i]')
    for (const el of Array.from(els)) {
      const txt = (el as HTMLElement).innerText || ""
      const m = txt.match(/\$\s*([\d,]+)/)
      if (m) {
        const n = parseInt(m[1].replace(/,/g, ""), 10)
        if (!isNaN(n) && n > 0 && n < 5000) return n
      }
    }
    return null
  })
  if (communityHoa) console.log(`  HOA: $${communityHoa}/mo`)

  // Try clicking a QMI / Available Homes tab
  for (const tabText of ["Quick Move-In", "Available Homes", "Move-In Ready"]) {
    try {
      const tab = page.locator(`a:has-text('${tabText}'), button:has-text('${tabText}')`)
      if (await tab.first().isVisible({ timeout: 2000 })) {
        await tab.first().click()
        await page.waitForTimeout(randomDelayMs(1500, 3000))
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

    // Visit detail page to get move-in date, HOA, taxes, and floors
    let moveInDate = raw.moveInDate || undefined
    let detailHoa: number | undefined
    let detailTaxes: number | undefined
    let detailFloors: number | undefined
    let detailIncentives: string | undefined
    if (raw.sourceUrl && raw.sourceUrl !== communityUrl) {
      console.log(`    Fetching detail page: ${raw.sourceUrl}`)
      const detail = await scrapeDetailPage(page, raw.sourceUrl)
      moveInDate = moveInDate || detail.moveInDate
      detailHoa = detail.hoaFees
      detailTaxes = detail.taxes
      detailFloors = detail.floors
      detailIncentives = detail.incentives
      await page.waitForTimeout(randomDelayMs(500, 1200))
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
      floors: floorsFromDetails ?? detailFloors ?? parseFloors(raw.planName),
      price,
      pricePerSqft: price && sqft ? Math.round(price / sqft) : undefined,
      propertyType,
      hoaFees: detailHoa || communityHoa || undefined,
      taxes: detailTaxes,
      moveInDate,
      incentives: detailIncentives,
      sourceUrl: raw.sourceUrl,
    })
  }

  return listings
}

// ── Toll Apollo: map-based lot status scraper ─────────────────────────────────
// Reads the interactive SVG site plan to get per-lot status counts.
// Status mapping:
//   Available, Quick Move-In  → forSale
//   Sold, Reserved            → sold
//   Not Released, Unavailable, (anything else) → future

export interface TollApolloLot {
  lotNum: string
  status: string
  planName: string
}

export interface TollApolloPlanSpec {
  beds?: number
  bedsMax?: number   // for ranges like "3–4"
  baths?: number
  sqft?: number
  floors?: number
  propertyType?: string
}

export interface TollApolloResult {
  forSale: number
  sold: number
  future: number
  total: number
  lots: TollApolloLot[]
  /** Floor plan specs keyed by plan name, scraped from the community page */
  planSpecs: Record<string, TollApolloPlanSpec>
  /** Per-lot prices keyed by lot number string (e.g. "36") — from QMI/specific lot ModelCards */
  lotPrices: Record<string, number>
  /** Plan-level "from" prices keyed by plan name — fallback when no specific lot price exists */
  planPrices: Record<string, number>
  /** Street addresses keyed by lot number — from QMI ModelCard "Home Site N | Street Address" */
  lotAddresses: Record<string, string>
}

export async function scrapeTollApollo(rawUrl: string): Promise<TollApolloResult> {
  // Normalize URL: strip query params and limit to the Collection path segment
  // e.g. .../Alder-Collection/Kuro?utm=... → .../Alder-Collection
  const communityUrl = (() => {
    try {
      const u = new URL(rawUrl)
      // Keep only path segments up to and including the *-Collection segment
      const segments = u.pathname.split('/').filter(Boolean)
      const collectionIdx = segments.findIndex(s => /-Collection$/i.test(s))
      const cleanPath = collectionIdx >= 0
        ? '/' + segments.slice(0, collectionIdx + 1).join('/')
        : u.pathname
      return `${u.origin}${cleanPath}`
    } catch {
      return rawUrl
    }
  })()

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  try {
    console.log(`[TollApollo] Loading: ${communityUrl}`)
    await page.goto(communityUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)

    // ── 1. Scrape floor plan specs + per-lot prices from ModelCard elements ──────
    const { planSpecs, lotPrices, planPrices, lotAddresses } = await page.evaluate(() => {
      const specs: Record<string, { beds?: number; bedsMax?: number; baths?: number; sqft?: number }> = {}
      const prices: Record<string, number> = {}      // lotNum → price (QMI/specific lots)
      const fromPrices: Record<string, number> = {}  // planName → "from" price (plan-level cards)
      const addresses: Record<string, string> = {}   // lotNum → street address

      const seen = new Set<Element>()
      const cards = Array.from(document.querySelectorAll('[class*="ModelCard_modelCardContainer"]'))
      for (const card of cards) {
        if (seen.has(card)) continue
        seen.add(card)

        const nameEl = card.querySelector('[class*="ModelCard_name"]') as HTMLElement | null
        const planName = nameEl?.innerText?.trim().split('\n')[0].trim()
        if (!planName) continue

        // Extract address — "Home Site 36\n | 152 Jack" format for QMI lots
        const addrEl =
          card.querySelector('[class*="calloutAddressWrapper"]') as HTMLElement | null ||
          card.querySelector('[class*="address"]') as HTMLElement | null
        const addrRaw = addrEl?.innerText?.trim() || ''
        const lotMatch = addrRaw.match(/(?:home\s*site|lot)\s*(\d+)/i)
        const lotNum = lotMatch ? lotMatch[1] : ''

        // Street address is the part after " | " (e.g. "152 Jack")
        const streetParts = addrRaw.split('|')
        const streetAddr = streetParts.length > 1 ? streetParts[streetParts.length - 1].trim() : ''
        if (lotNum && streetAddr) addresses[lotNum] = streetAddr

        // Extract price
        const priceEl =
          card.querySelector('[class*="price__adjust"]') as HTMLElement | null ||
          card.querySelector('[class*="ModelCard_modelPrice"]') as HTMLElement | null
        const priceRaw = priceEl?.innerText?.trim() || ''
        const priceNum = priceRaw ? parseInt(priceRaw.replace(/[^0-9]/g, ''), 10) : 0

        if (priceNum > 100000) {
          if (lotNum) {
            // QMI/specific lot price
            prices[lotNum] = priceNum
          } else {
            // Plan-level "from" price — keyed by plan name
            if (!fromPrices[planName]) fromPrices[planName] = priceNum
          }
        }

        const text = (card as HTMLElement).innerText || ''
        const tokens = text.split(/\n+/).map((t: string) => t.trim()).filter(Boolean)

        let beds: number | undefined
        let bedsMax: number | undefined
        let baths: number | undefined
        let sqft: number | undefined
        let floors: number | undefined
        let propertyType: string | undefined

        for (let i = 0; i < tokens.length - 1; i++) {
          const label = tokens[i + 1].toLowerCase()
          const raw = tokens[i].replace(/,/g, '').replace(/\+/g, '')

          // Property type: text token before "home type" or "type" label
          if (label === 'home type' || label === 'type') {
            const normalized = raw.toLowerCase()
            if (normalized.includes('single') || normalized.includes('detach')) propertyType = 'single-family'
            else if (normalized.includes('condo') || normalized.includes('condominium')) propertyType = 'condo'
            else if (normalized.includes('town') || normalized.includes('attach')) propertyType = 'townhome'
            else propertyType = raw
            continue
          }

          const rangeMatch = raw.match(/^(\d+)[–\-](\d+)$/)
          if (rangeMatch) {
            const lo = parseInt(rangeMatch[1])
            const hi = parseInt(rangeMatch[2])
            if (label === 'bedrooms' || label === 'beds') { beds = lo; bedsMax = hi }
            continue
          }

          const n = parseFloat(raw)
          if (isNaN(n)) continue

          if (label === 'bedrooms' || label === 'beds') beds = n
          else if (label === 'baths' || label === 'bathrooms') baths = n
          else if (label === 'square feet' || label === 'sq ft') sqft = n
          else if (label === 'stories' || label === 'floors' || label === 'story') floors = Math.round(n)
        }

        if (!specs[planName]) {
          specs[planName] = { beds, bedsMax, baths, sqft, floors, propertyType }
        }
      }

      return { planSpecs: specs, lotPrices: prices, planPrices: fromPrices, lotAddresses: addresses }
    })

    console.log(`[TollApollo] Plan specs found: ${Object.keys(planSpecs).join(', ')}`)
    console.log(`[TollApollo] Lot prices found: ${Object.keys(lotPrices).length} lots | Plan prices: ${JSON.stringify(planPrices)} | Addresses: ${JSON.stringify(lotAddresses)}`)

    // ── 2. Scroll to site plan and trigger initial SVG render ─────────────────
    // Must scroll first so the React SVG component mounts (it's lazy-rendered).
    await page.evaluate(() => {
      const el = document.querySelector('[class*="CommunitySitePlan"]') ||
                 document.querySelector('[id="siteplan"]')
      if (el) el.scrollIntoView()
    })
    await page.waitForTimeout(2000)

    // Wait for SVG to be fully rendered (iterated="true" is set by Toll Brothers JS)
    try {
      await page.waitForFunction(() => {
        const svgs = document.querySelectorAll('svg')
        for (const svg of Array.from(svgs)) {
          if (svg.getAttribute('iterated') === 'true') return true
        }
        return false
      }, { timeout: 15000 })
    } catch {
      console.log('[TollApollo] SVG iterated flag not found, proceeding anyway')
    }

    // ── 3. Switch to community-specific site plan ─────────────────────────────
    // Page defaults to "Overall Site Plan" (all GPN communities).
    // After the SVG component is mounted (step 2), select the community plan
    // so the SVG re-renders showing only this community's lots.
    const collectionKeyword = communityUrl.split('/').pop()
      ?.replace(/-Collection$/i, '')
      .replace(/-/g, ' ')
      .trim() || ''

    if (collectionKeyword) {
      const sitePlanValue = await page.evaluate((keyword: string) => {
        const sel = document.getElementById('siteplanselection') as HTMLSelectElement | null
        if (!sel) return null
        const match =
          Array.from(sel.options).find(o =>
            o.text.toLowerCase().includes(keyword.toLowerCase()) && !/overall/i.test(o.text)
          ) ||
          Array.from(sel.options).find(o => !/overall/i.test(o.text) && !o.selected)
        return match ? match.value : null
      }, collectionKeyword)

      if (sitePlanValue) {
        console.log(`[TollApollo] Switching to community site plan for "${collectionKeyword}" (value: ${sitePlanValue})`)
        await page.selectOption('#siteplanselection', sitePlanValue)
        // SVG briefly disappears then re-renders; wait for the new iterated="true"
        await page.waitForTimeout(500)   // give React a moment to clear SVG
        try {
          await page.waitForFunction(() => {
            const svgs = document.querySelectorAll('svg')
            for (const svg of Array.from(svgs)) {
              if (svg.getAttribute('iterated') === 'true') return true
            }
            return false
          }, { timeout: 10000 })
          console.log(`[TollApollo] Community site plan rendered successfully`)
        } catch {
          console.log('[TollApollo] SVG re-render wait timed out after plan switch')
        }
      } else {
        console.log(`[TollApollo] No community-specific site plan found for "${collectionKeyword}"`)
      }
    }

    // ── 3. Read lot data from SVG + resolve "no data" lots via color legend ───
    const lots = await page.evaluate(() => {
      const results: Array<{ lotNum: string; status: string; planName: string }> = []

      const lotsGroups = Array.from(document.querySelectorAll('g[id]')).filter(g => {
        return /^LOTS-\d+$/.test(g.id)
      })

      // Collect all raw lot data including the lot color
      const rawLots: Array<{ lotNum: string; status: string; planName: string; color: string }> = []
      for (const group of lotsGroups) {
        const shapes = Array.from(group.querySelectorAll('polygon, path, rect'))
        for (const shape of shapes) {
          const el = shape as HTMLElement
          const lotNum = el.dataset['lot_num'] || ''
          const status = el.dataset['lot_status'] || ''
          const planName = el.dataset['lot_name'] || ''
          const color = (el as any).getAttribute('data-lotColor') || el.dataset['lotColor'] || ''
          if (lotNum || status) {
            rawLots.push({ lotNum, status, planName, color })
          }
        }
      }

      // Build color → planName from lots that already have a name
      const colorToPlan: Record<string, string> = {}
      for (const lot of rawLots) {
        if (lot.planName && lot.planName !== 'no data' && lot.color) {
          if (!colorToPlan[lot.color]) colorToPlan[lot.color] = lot.planName
        }
      }

      // Read plan names listed in the SVG legend text
      // The legend renders as SVG <text> elements — find all short title-case strings near "LEGEND"
      const legendPlanNames: string[] = []
      let inLegend = false
      const svgTexts = Array.from(document.querySelectorAll('svg text'))
      for (const t of svgTexts) {
        const txt = (t as SVGTextElement).textContent?.trim() || ''
        if (txt.toUpperCase() === 'LEGEND') { inLegend = true; continue }
        if (inLegend && /^[A-Z][a-zA-Z\s]{1,20}$/.test(txt) && txt.length < 25) {
          legendPlanNames.push(txt)
        } else if (inLegend && txt.length > 0 && legendPlanNames.length > 0) {
          // Stop after a few non-plan-name entries
          if (!/^[A-Z][a-zA-Z\s]{1,20}$/.test(txt)) inLegend = false
        }
      }

      // Find any plan names in the legend not yet in colorToPlan
      const knownPlanNames = new Set(Object.values(colorToPlan))
      const unknownPlanNames = legendPlanNames.filter(n => !knownPlanNames.has(n))

      // Find colors used by "no data" lots that aren't in colorToPlan yet
      const unknownColors = new Set<string>()
      for (const lot of rawLots) {
        if ((lot.planName === 'no data' || !lot.planName) && lot.color && !colorToPlan[lot.color]) {
          unknownColors.add(lot.color)
        }
      }

      // If exactly one unknown plan and one unknown color, map them
      if (unknownPlanNames.length === 1 && unknownColors.size === 1) {
        colorToPlan[Array.from(unknownColors)[0]] = unknownPlanNames[0]
      } else if (unknownPlanNames.length > 0 && unknownColors.size > 0) {
        // Best-effort: assign each unknown color to an unknown plan in order
        const uColors = Array.from(unknownColors)
        unknownPlanNames.forEach((name, i) => {
          if (uColors[i]) colorToPlan[uColors[i]] = name
        })
      }

      // Resolve "no data" plan names using the color map
      for (const lot of rawLots) {
        const resolvedPlan = (lot.planName && lot.planName !== 'no data')
          ? lot.planName
          : (colorToPlan[lot.color] || lot.planName)
        results.push({ lotNum: lot.lotNum, status: lot.status, planName: resolvedPlan })
      }

      return results
    })

    // ── 4. Categorize by user's rules ─────────────────────────────────────────
    let forSale = 0
    let sold = 0
    let future = 0

    for (const lot of lots) {
      const s = lot.status.toLowerCase()
      const isQMI = lot.lotNum in lotPrices || lot.lotNum in lotAddresses
      if (isQMI) {
        forSale++
      } else if (s === 'sold' || s === 'reserved') {
        sold++
      } else {
        future++
      }
    }

    console.log(`[TollApollo] Total lots: ${lots.length} | forSale: ${forSale} | sold: ${sold} | future: ${future}`)

    return { forSale, sold, future, total: lots.length, lots, planSpecs, lotPrices, planPrices, lotAddresses }
  } finally {
    await browser.close()
  }
}
