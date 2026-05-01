import { chromium, type Page } from "playwright"
import type { ScrapedListing } from "./toll-brothers"
import { parseFloors } from "./toll-brothers"
import { cleanAddress } from "./clean-address"
import { randomDelayMs, randomUserAgent } from "./utils"

const BASE_URL = "https://www.lennar.com"

/** Lennar find-a-home search page scoped to Orange County bounding box */
const SEARCH_URL = `${BASE_URL}/find-a-home?county=orange%20county&state=ca`

/** OC cities to filter results (search bbox includes some non-OC areas) */
const OC_CITIES = new Set([
  "irvine", "newport beach", "laguna niguel", "laguna beach", "laguna hills",
  "mission viejo", "lake forest", "rancho santa margarita", "san clemente",
  "san juan capistrano", "aliso viejo", "dana point", "tustin", "orange",
  "anaheim", "yorba linda", "brea", "placentia", "fullerton", "buena park",
  "huntington beach", "fountain valley", "westminster", "garden grove",
  "santa ana", "seal beach", "los alamitos", "cypress", "stanton", "la habra",
  "villa park", "rancho mission viejo", "costa mesa", "ladera ranch",
])

/** Known plan → floor count (plans don't encode stories in their names) */
const LENNAR_PLAN_FLOORS: Record<string, number> = {
  "isla": 3, "rhea": 3,
  "rhea 3": 3, "rhea 2": 3, "rhea 1": 3,
  "isla 1": 3, "isla 2": 3, "isla 3": 3,
}

function lennarPlanFloors(planName: string | undefined): number | undefined {
  if (!planName) return undefined
  const key = planName.toLowerCase().trim()
  if (LENNAR_PLAN_FLOORS[key] !== undefined) return LENNAR_PLAN_FLOORS[key]
  for (const [k, v] of Object.entries(LENNAR_PLAN_FLOORS)) {
    if (key.startsWith(k)) return v
  }
  return undefined
}

/** "912 Chinon Irvine, CA" → "912 Chinon" */

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

/** Map known plan prefixes to their proper sub-community for Great Park */
const GREAT_PARK_PLAN_MAP: Record<string, string> = {
  "rhea": "Rhea at Luna Park",
  "isla": "Isla at Luna Park",
  "nova": "Nova - Active Adult",
  "strata": "Strata - Active Adult",
}

/** If community is generic "Great Park Neighborhoods", resolve to specific sub-community using plan name */
function resolveGreatParkCommunity(communityName: string, planName?: string): string {
  if (!planName || !communityName.toLowerCase().includes("great park")) return communityName
  const planPrefix = planName.split(/\s+/)[0].toLowerCase()
  return GREAT_PARK_PLAN_MAP[planPrefix] || communityName
}

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
  if (baths != null && halfBaths > 0) baths = baths + halfBaths * 0.5
  return { beds, baths, sqft }
}

/** Extract community base URL from homesite URL */
function communityUrlFromHref(href: string): string {
  const parts = href.replace(BASE_URL, "").split("/").filter(Boolean)
  // /new-homes/california/orange-county/<city>/<community>
  if (parts.length >= 5) {
    return `${BASE_URL}/${parts.slice(0, 5).join("/")}`
  }
  return href
}

/** Derive city from a Lennar URL path */
function cityFromUrl(url: string): string {
  // /new-homes/california/orange-county/fullerton/... → "fullerton"
  const parts = url.replace(BASE_URL, "").split("/").filter(Boolean)
  // parts: ["new-homes", "california", "orange-county", "fullerton", ...]
  return parts[3]?.replace(/-/g, " ") || ""
}

// ─── Property Details scraping ──────────────────────────────────────────

/** Visit the /property-details page and extract all fields using DOM div-pair structure */
async function scrapeLennarPropertyDetails(page: Page, listingUrl: string): Promise<{
  lotNumber?: string
  floors?: number
  hoaFees?: number
  taxRate?: number
  garages?: number
  propertyType?: string
  moveInDate?: string
  sqft?: number
  beds?: number
  baths?: number
  communityFromPD?: string
  cityFromPD?: string
  incentives?: string
}> {
  const pdUrl = listingUrl.endsWith("/property-details")
    ? listingUrl
    : `${listingUrl}/property-details`
  try {
    await page.goto(pdUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    // Wait for property details content to appear
    await page.waitForFunction(
      () => document.body.innerText.includes("Tax rate") || document.body.innerText.includes("Homesite"),
      { timeout: 15000 }
    ).catch(() => {})
    await page.waitForTimeout(randomDelayMs(300, 800))

    return await page.evaluate(() => {
      // Lennar property-details page uses divs with exactly 2 children: label + value
      const kv: Record<string, string> = {}
      document.querySelectorAll("div, li").forEach(el => {
        const children = el.children
        if (children.length !== 2) return
        const k = (children[0] as HTMLElement).innerText?.trim()
        const v = (children[1] as HTMLElement).innerText?.trim()
        if (k && v && k.length < 80 && !k.includes("\n") && !kv[k]) {
          kv[k] = v
        }
      })

      function get(...keys: string[]): string | undefined {
        for (const searchKey of keys) {
          const found = Object.keys(kv).find(k => k.toLowerCase().includes(searchKey.toLowerCase()))
          if (found) return kv[found]
        }
        return undefined
      }

      // Lot number
      const lotRaw = get("Homesite")
      const lotNumber = lotRaw?.replace(/[^0-9]/g, "") || undefined

      // Property type
      const propertyType = get("Property type") || undefined

      // Neighborhood → community name + city
      const neighborhoodRaw = get("Neighborhood")
      let communityFromPD: string | undefined
      let cityFromPD: string | undefined
      if (neighborhoodRaw) {
        const parts = neighborhoodRaw.split("\n").map(s => s.trim()).filter(Boolean)
        communityFromPD = parts[0] || undefined
        cityFromPD = (parts[1] || "").replace(/,\s*CA\s*\d*$/, "").trim() || undefined
      }

      // Home size → sqft
      let sqft: number | undefined
      const sizeRaw = get("Home size")
      if (sizeRaw) {
        const m = sizeRaw.match(/([\d,]+)/)
        if (m) sqft = parseInt(m[1].replace(/,/g, ""), 10)
      }

      // Stories → floors
      let floors: number | undefined
      const storiesRaw = get("Stories")
      if (storiesRaw) floors = parseInt(storiesRaw.trim(), 10) || undefined

      // Rooms → beds + baths
      let beds: number | undefined
      let baths: number | undefined
      const roomsRaw = get("Rooms")
      if (roomsRaw) {
        const bedsM = roomsRaw.match(/(\d+)\s*bedroom/i)
        if (bedsM) beds = parseInt(bedsM[1], 10)
        const bathsM = roomsRaw.match(/(\d+)\s*bathroom/i)
        const halfM = roomsRaw.match(/(\d+)\s*half\s*bath/i)
        const fullBaths = bathsM ? parseInt(bathsM[1], 10) : 0
        const halfBaths = halfM ? parseInt(halfM[1], 10) : 0
        if (fullBaths || halfBaths) baths = fullBaths + halfBaths * 0.5
      }

      // Parking → garages
      let garages: number | undefined
      const parkingRaw = get("Parking")
      if (parkingRaw) {
        const m = parkingRaw.match(/(\d+)/)
        if (m) garages = parseInt(m[1], 10)
      }

      // Tax rate
      let taxRate: number | undefined
      const taxRaw = get("Tax rate")
      if (taxRaw) {
        const m = taxRaw.match(/([\d.]+)/)
        if (m) taxRate = parseFloat(m[1])
      }

      // Special assessment / HOA fee
      let hoaFees: number | undefined
      const hoaRaw = get("Special assessment", "HOA", "Association fee", "Community fee")
      if (hoaRaw) {
        const m = hoaRaw.match(/\$?([\d,]+(?:\.\d+)?)/)
        if (m) hoaFees = Math.round(parseFloat(m[1].replace(/,/g, "")))
      }

      // Listing status → moveInDate
      let moveInDate: string | undefined
      const statusRaw = get("Listing status")
      if (statusRaw) {
        const s = statusRaw.toLowerCase()
        if (s.includes("move-in ready") || s.includes("move in ready") || s.includes("quick")) moveInDate = "Move-In Ready"
        else if (s.includes("under construction")) moveInDate = "Under Construction"
        else if (s.includes("coming soon")) moveInDate = "Coming Soon"
        else if (s.includes("for sale")) moveInDate = "For Sale"
      }

      return { lotNumber, floors, hoaFees, taxRate, garages, propertyType, moveInDate, sqft, beds, baths, communityFromPD, cityFromPD }
    })
  } catch {
    return {}
  }
}

/** Visit the main listing page for floors (SlashMenu tabs), move-in date, and incentives */
async function scrapeLennarDetailPage(page: Page, url: string): Promise<{
  floors?: number
  moveInDate?: string
  incentives?: string
}> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(randomDelayMs(1500, 3000))

    const basicResult = await page.evaluate(() => {
      const body = (document.body as HTMLElement).innerText || ""

      const floorTabs = document.querySelectorAll('[class*="SlashMenu_label"]')
      const floors = floorTabs.length > 0 ? floorTabs.length : undefined

      let moveInDate: string | undefined
      const m = body.match(/Available\s+(\d{1,2}\/\d{4})/i)
      if (m) moveInDate = `Available ${m[1]}`
      else if (/quick\s*move[-\s]?in/i.test(body)) moveInDate = "Quick Move-In"
      else if (/move[-\s]?in\s*ready/i.test(body)) moveInDate = "Move-In Ready"
      const dateEl = document.querySelector('[class*="Availability_label"], [class*="moveIn"], [class*="availability"]') as HTMLElement | null
      if (!moveInDate && dateEl?.innerText?.trim()) {
        moveInDate = dateEl.innerText.trim().replace(/^quick\s+move[-\s]?in\s*/i, "").trim() || dateEl.innerText.trim()
      }

      // Find offer link to click through for details
      let offerHref: string | undefined
      const offerSelectors = [
        '[class*="incentive"] a', '[class*="Incentive"] a',
        '[class*="promotion"] a', '[class*="Promotion"] a',
        '[class*="offer"] a', '[class*="specialOffer"] a',
        'a[href*="offer"]', 'a[href*="incentive"]', 'a[href*="promotion"]',
      ]
      for (const sel of offerSelectors) {
        const link = document.querySelector(sel) as HTMLAnchorElement | null
        if (link?.href) { offerHref = link.href; break }
      }

      // Also grab the teaser text as a fallback
      let teaserText: string | undefined
      const incentiveSelectors = [
        '[class*="incentive"]', '[class*="Incentive"]',
        '[class*="promotion"]', '[class*="Promotion"]',
        '[class*="offer"]', '[class*="specialOffer"]',
        '[class*="HomesiteCard_newDescription"]',
      ]
      for (const sel of incentiveSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        const txt = el?.innerText?.trim()
        if (txt && txt.length > 5 && txt.length < 500) { teaserText = txt; break }
      }

      return { floors, moveInDate, offerHref, teaserText }
    })

    // Try clicking "View offer" button to open modal and read details
    let incentives: string | undefined

    if (basicResult.offerHref) {
      try {
        incentives = await scrapeLennarOfferPage(page, basicResult.offerHref)
      } catch {
        // Fall back to click approach
      }
    }

    if (!incentives) {
      try {
        // Try clicking "View offer" link/button to open a modal
        const offerBtn = await page.$('a:has-text("View offer"), button:has-text("View offer"), [class*="offer"] a, [class*="offer"] button')
        if (offerBtn) {
          await offerBtn.click()
          await page.waitForTimeout(randomDelayMs(1500, 3000))

          // Read modal/overlay content
          incentives = await page.evaluate(() => {
            // Look for modal/dialog/overlay that appeared
            const modalSelectors = [
              '[class*="modal"]', '[class*="Modal"]',
              '[class*="dialog"]', '[class*="Dialog"]',
              '[class*="overlay"]', '[class*="Overlay"]',
              '[class*="popup"]', '[class*="Popup"]',
              '[role="dialog"]', '[role="alertdialog"]',
            ]
            for (const sel of modalSelectors) {
              const modal = document.querySelector(sel) as HTMLElement | null
              const txt = modal?.innerText?.trim()
              if (txt && txt.length > 30 && txt.length < 3000) {
                return txt.replace(/\n{3,}/g, "\n\n").trim()
              }
            }

            // If no modal, check if the page content changed — look for offer detail text
            const body = document.body.innerText || ""
            const patterns = [
              /(?:save|get|receive|up to)\s+\$[\d,]+[^\n]*(?:\n[^\n]{5,200}){0,5}/gi,
              /(?:closing\s+cost|rate\s+buy[-\s]?down|design\s+credit|upgrade|flex\s+cash|interest\s+rate)[^\n]*(?:\n[^\n]{5,200}){0,5}/gi,
            ]
            const found: string[] = []
            for (const pat of patterns) {
              const matches = body.match(pat)
              if (matches) {
                for (const m of matches) {
                  const cleaned = m.trim()
                  if (cleaned.length > 15 && cleaned.length < 500 && !found.includes(cleaned)) {
                    found.push(cleaned)
                  }
                }
              }
            }
            if (found.length > 0) return found.join(" | ")
            return undefined
          })

          // Try to close modal
          const closeBtn = await page.$('[class*="close"], [class*="Close"], button[aria-label="Close"], [class*="modal"] button')
          if (closeBtn) await closeBtn.click().catch(() => {})
        }
      } catch {
        // Ignore click errors
      }
    }

    // Fall back to teaser text (strip "View offer" suffix)
    if (!incentives && basicResult.teaserText) {
      incentives = basicResult.teaserText
        .replace(/\n?\s*view\s+offer\s*$/i, "")
        .trim() || basicResult.teaserText
    }

    return { floors: basicResult.floors, moveInDate: basicResult.moveInDate, incentives }
  } catch {
    return {}
  }
}

/** Navigate to a Lennar offer/promotion page and extract the full offer details */
async function scrapeLennarOfferPage(page: Page, offerUrl: string): Promise<string | undefined> {
  try {
    await page.goto(offerUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(randomDelayMs(1500, 3000))

    return await page.evaluate(() => {
      const body = document.body as HTMLElement
      const bodyText = body.innerText || ""

      // Try to find structured offer content
      const detailSelectors = [
        '[class*="offerDetail"]', '[class*="OfferDetail"]',
        '[class*="promotionDetail"]', '[class*="PromotionDetail"]',
        '[class*="incentiveDetail"]', '[class*="IncentiveDetail"]',
        '[class*="offerContent"]', '[class*="OfferContent"]',
        '[class*="promoContent"]', '[class*="PromoContent"]',
        'article', '[class*="content"]',
        'main',
      ]

      for (const sel of detailSelectors) {
        const el = document.querySelector(sel) as HTMLElement | null
        const txt = el?.innerText?.trim()
        if (txt && txt.length > 20 && txt.length < 2000) {
          // Clean up: remove excessive whitespace, nav items, etc.
          const cleaned = txt
            .replace(/\n{3,}/g, "\n\n")
            .replace(/\t+/g, " ")
            .trim()
          if (cleaned.length > 20) return cleaned
        }
      }

      // Try regex patterns on full page text for common Lennar offer formats
      const patterns = [
        /(?:save|get|receive|earn|up to)\s+\$[\d,]+[^\n]*(?:\n[^\n]{5,120}){0,3}/gi,
        /(?:closing\s+cost|rate\s+buy[-\s]?down|design\s+credit|upgrade|flex\s+cash)[^\n]*(?:\n[^\n]{5,120}){0,3}/gi,
        /(?:limited[- ]time|special\s+offer|exclusive)[^\n]*(?:\n[^\n]{5,120}){0,3}/gi,
      ]

      const found: string[] = []
      for (const pat of patterns) {
        const matches = bodyText.match(pat)
        if (matches) {
          for (const m of matches) {
            const cleaned = m.trim()
            if (cleaned.length > 15 && cleaned.length < 500 && !found.includes(cleaned)) {
              found.push(cleaned)
            }
          }
        }
      }

      if (found.length > 0) return found.join(" | ")

      return undefined
    })
  } catch {
    return undefined
  }
}

// ─── Main scraper ───────────────────────────────────────────────────────

type ApolloHomesite = {
  href: string
  price: number
  address: string
  city: string
  beds: number
  baths: number
  halfBaths: number
  sqft: number
  planName: string
  communityName: string
  mpcName: string
  lotNumber: string
  lotId: string
  status: string
}

/** Extract all homesites from __NEXT_DATA__ Apollo state */
async function extractApolloHomesites(page: Page): Promise<ApolloHomesite[]> {
  return await page.evaluate(() => {
    const results: Array<{
      href: string; price: number; address: string; city: string;
      beds: number; baths: number; halfBaths: number; sqft: number;
      planName: string; communityName: string; mpcName: string;
      lotNumber: string; lotId: string; status: string;
    }> = []

    const nextDataEl = document.getElementById("__NEXT_DATA__")
    if (!nextDataEl) return results

    try {
      const nextData = JSON.parse(nextDataEl.textContent || "")
      const state = nextData?.props?.pageProps?.initialApolloState
        || nextData?.props?.pageProps?.apolloState
        || {}

      // Build lookup maps
      const plans: Record<string, { name: string; communityRef: string }> = {}
      const communities: Record<string, { name: string; mpcRef: string; cityRef: string }> = {}
      const mpcs: Record<string, string> = {}
      const cities: Record<string, string> = {}

      for (const [key, val] of Object.entries(state)) {
        const v = val as Record<string, unknown>
        if (key.startsWith("PlanType:")) {
          plans[key] = {
            name: (v.name as string) || (v.planName as string) || "",
            communityRef: (v.community as Record<string, string>)?.__ref || "",
          }
        } else if (key.startsWith("CommunityType:")) {
          communities[key] = {
            name: (v.name as string) || "",
            mpcRef: (v.mpc as Record<string, string>)?.__ref || "",
            cityRef: (v.city as Record<string, string>)?.__ref || "",
          }
        } else if (key.startsWith("MpcType:")) {
          mpcs[key] = (v.name as string) || ""
        } else if (key.startsWith("CityType:")) {
          cities[key] = (v.name as string) || ""
        }
      }

      for (const [key, val] of Object.entries(state)) {
        const v = val as Record<string, unknown>
        if (!key.startsWith("HomesiteType:")) continue
        const price = v.price as number
        const address = v.address as string
        if (!price || !address) continue

        const planRef = (v.plan as Record<string, string>)?.__ref || ""
        const plan = plans[planRef]
        const comm = plan?.communityRef ? communities[plan.communityRef] : undefined
        const communityName = comm?.name || ""
        const mpcName = comm?.mpcRef ? (mpcs[comm.mpcRef] || "") : ""
        const cityName = comm?.cityRef ? (cities[comm.cityRef] || "") : ""

        results.push({
          href: (v.url as string) || "",
          price,
          address,
          city: cityName,
          beds: (v.beds as number) || 0,
          baths: (v.baths as number) || 0,
          halfBaths: (v.halfBaths as number) || 0,
          sqft: (v.sqft as number) || 0,
          planName: plan?.name || "",
          communityName,
          mpcName,
          lotNumber: (v.number as string) || "",
          lotId: (v.lotid as string) || "",
          status: (v.status as string) || "",
        })
      }
    } catch {
      // skip
    }

    return results
  })
}

/** Build the full community name: "MPC - Collection" or just "Collection" */
function buildCommunityName(mpcName: string, collectionName: string): string {
  if (mpcName && collectionName && mpcName !== collectionName) {
    return `${mpcName} - ${collectionName}`
  }
  return collectionName || mpcName || "Unknown"
}

/** Build a listing detail URL from its URL path parts */
function buildDetailUrl(raw: ApolloHomesite): string {
  // If the homesite has a full URL, use it
  if (raw.href && raw.href.startsWith("http")) return raw.href
  if (raw.href && raw.href.startsWith("/")) return `${BASE_URL}${raw.href}`
  // Otherwise, we can't build a URL
  return ""
}


/**
 * Traverse the React fiber tree on the current page to find the GeoJSON map
 * component's lot data. Returns all lot IDs whose prefix matches `prefix`.
 * These include every lot on the site plan — including unreleased ones not
 * yet visible in the Apollo __NEXT_DATA__ state.
 */
async function extractGeoJsonLotIds(page: Page, prefix: string): Promise<string[]> {
  // Embed the prefix directly into the script string to avoid tsx injecting __name() helpers.
  // Named functions (function declarations / named arrow functions) inside page.evaluate
  // cause a ReferenceError because tsx adds __name() calls that aren't available in browser context.
  const pfx = JSON.stringify(prefix)
  const script = `
    (function() {
      var lotIdPrefix = ${pfx}
      var candidates = Array.from(document.querySelectorAll("[class*='map'],[class*='Map'],[class*='sitePlan'],[id*='map']"))
      candidates.push(document.body)
      for (var ci = 0; ci < candidates.length; ci++) {
        var el = candidates[ci]
        var fiber = null
        var keys = Object.keys(el)
        for (var ki = 0; ki < keys.length; ki++) {
          if (keys[ki].startsWith('__reactFiber') || keys[ki].startsWith('__reactInternalInstance')) {
            fiber = el[keys[ki]]
            break
          }
        }
        if (!fiber) continue
        for (var iter = 0; iter < 500 && fiber; iter++) {
          var s = fiber.memoizedState
          while (s) {
            var ms = s.memoizedState
            if (ms && typeof ms === 'object' && 'geoJsonData' in ms) {
              var geo = ms.geoJsonData
              if (geo && geo.features && geo.features.length > 0) {
                return geo.features.map(function(f) { return String(f.id) }).filter(function(id) { return id.startsWith(lotIdPrefix) })
              }
            }
            if (s && typeof s === 'object' && 'geoJsonData' in s) {
              var geo2 = s.geoJsonData
              if (geo2 && geo2.features && geo2.features.length > 0) {
                return geo2.features.map(function(f) { return String(f.id) }).filter(function(id) { return id.startsWith(lotIdPrefix) })
              }
            }
            s = s.next
          }
          fiber = fiber.return || fiber.child || fiber.sibling || null
        }
      }
      return []
    })()
  `
  return await page.evaluate(script)
}

// ─── Single-community scraper ─────────────────────────────────────────────────

/**
 * Scrape a single Lennar community by URL.
 * Handles both HomesiteCard (city-level) and Apollo state (collection-level) formats.
 *
 * collectionFilter: optional community/collection name (e.g. "Hazel") used to
 * filter results when the URL returns multiple collections. Also used as the
 * Apollo pre-filter keyword.
 */
export async function scrapeLennarCommunity(communityUrl: string, collectionFilter?: string): Promise<ScrapedListing[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: randomUserAgent() })
  const allListings: ScrapedListing[] = []
  const seenAddresses = new Set<string>()

  try {
    const page = await context.newPage()
    console.log(`[Lennar] Loading: ${communityUrl}`)
    await page.goto(communityUrl, { waitUntil: "domcontentloaded", timeout: 60000 })

    const hasCards = await page.waitForSelector('[class*="HomesiteCard_link"]', { timeout: 10000 }).catch(() => null)

    if (hasCards) {
      // ── HomesiteCard format (city-level pages) ──────────────────────────
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(randomDelayMs(1500, 3000))
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(randomDelayMs(1500, 3000))

      const rawCards = await page.evaluate(() => {
        const results: Array<{
          href: string; priceText: string; metaItems: string[];
          addressText: string; lotText: string; descriptionText: string; statusText: string;
        }> = []
        document.querySelectorAll('[class*="HomesiteCard_link"]').forEach((card) => {
          const href = (card as HTMLAnchorElement).href || ""
          if (!href) return
          results.push({
            href,
            priceText: (card.querySelector('[class*="headline4New"]') as HTMLElement)?.innerText?.trim() || "",
            metaItems: Array.from(card.querySelectorAll('[class*="MetaDetails_baseItem"]')).map(e => (e as HTMLElement).innerText?.trim() || ""),
            addressText: (card.querySelector('[class*="HomesiteCard_addressWrapper"]') as HTMLElement)?.innerText?.trim() || "",
            lotText: (card.querySelector('[class*="HomesiteCard_lotId"]') as HTMLElement)?.innerText?.trim() || "",
            descriptionText: (card.querySelector('[class*="HomesiteCard_newDescription"]') as HTMLElement)?.innerText?.trim() || "",
            statusText: (card.querySelector('[class*="Availability_label"]') as HTMLElement)?.innerText?.trim() || "",
          })
        })
        return results
      })

      // Filter by collection if requested
      const filtered = collectionFilter
        ? rawCards.filter(r => r.descriptionText.toLowerCase().includes(collectionFilter.toLowerCase()))
        : rawCards

      console.log(`  [Lennar] ${filtered.length} listings (card format${collectionFilter ? `, filter="${collectionFilter}"` : ""})`)

      for (const raw of filtered) {
        const { planName, communityName } = parsePlanAndCommunity(raw.descriptionText)
        if (!raw.addressText) continue
        const { beds, baths, sqft } = parseMeta(raw.metaItems)
        const price = parsePrice(raw.priceText)
        const address = cleanAddress(raw.addressText)
        if (!address || seenAddresses.has(address)) continue
        seenAddresses.add(address)

        const statusLower = raw.statusText.toLowerCase()
        let moveInDate: string | undefined =
          statusLower.includes("move-in") || statusLower.includes("quick") || statusLower.includes("ready")
            ? raw.statusText : undefined

        const pd = await scrapeLennarPropertyDetails(page, raw.href)
        const detail = await scrapeLennarDetailPage(page, raw.href)
        moveInDate = moveInDate || pd.moveInDate || detail.moveInDate
        await page.waitForTimeout(randomDelayMs(300, 800))

        allListings.push({
          communityName: "",   // filled by applySheetDefaults
          communityUrl,
          city: "",            // filled by applySheetDefaults
          address,
          lotNumber: pd.lotNumber || parseLotNumber(raw.lotText),
          floorPlan: planName || undefined,
          sqft: pd.sqft || sqft,
          beds: pd.beds || beds,
          baths: pd.baths || baths,
          garages: pd.garages,
          floors: lennarPlanFloors(planName) ?? pd.floors ?? detail.floors ?? parseFloors(planName),
          price,
          pricePerSqft: price && (pd.sqft || sqft) ? Math.round(price / (pd.sqft || sqft)!) : undefined,
          propertyType: pd.propertyType || "",
          hoaFees: pd.hoaFees,
          taxes: pd.taxRate && price ? Math.round(price * pd.taxRate / 100) : undefined,
          moveInDate,
          sourceUrl: raw.href,
          incentives: detail.incentives,
        })
      }
    } else {
      // ── Apollo state format (collection-level pages) ───────────────────
      await page.waitForTimeout(randomDelayMs(2000, 4000))

      // Detect Nova-style schema vs old schema
      const isNewSchema = await page.evaluate(() => {
        const nd = document.getElementById("__NEXT_DATA__")
        if (!nd) return false
        const apollo = JSON.parse(nd?.textContent || "{}").props?.pageProps?.initialApolloState || {}
        const hsKey = Object.keys(apollo as Record<string, unknown>).find(k => k.startsWith("HomesiteType"))
        if (!hsKey) return false
        const hs = (apollo as Record<string, unknown>)[hsKey] as Record<string, unknown>
        return typeof hs?.status === "string" && !("lotStatus" in hs)
      })
      console.log(`  [Lennar] Schema: ${isNewSchema ? "Nova-style" : "Old Apollo"}`)

      if (isNewSchema) {
        // ── Nova-style schema ────────────────────────────────────────────
        const novaListings = await page.evaluate((pageUrl: string) => {
          const nd = document.getElementById("__NEXT_DATA__")
          if (!nd) return []
          const data = JSON.parse(nd.textContent || "{}")
          const apollo = data?.props?.pageProps?.initialApolloState || {}
          const keys = Object.keys(apollo)
          const BASE = "https://www.lennar.com"

          const results: Array<{
            address: string; price: number | undefined; sqft: number | undefined
            beds: number | undefined; baths: number | undefined; planName: string | undefined
            sourceUrl: string; hasOwnUrl: boolean; status: string
            lotNumber: string | undefined; lotId: string | undefined
            apolloCollectionName: string
          }> = []

          for (const key of keys) {
            if (!key.startsWith("HomesiteType")) continue
            const h = apollo[key] as Record<string, unknown>
            if (!h?.address) continue

            const planRef = (h?.plan as { __ref?: string })?.__ref
            const plan = planRef ? (apollo[planRef] as Record<string, unknown>) : null
            const planCommunityRef = (plan?.community as { __ref?: string })?.__ref
            const planCommunityObj = planCommunityRef ? (apollo[planCommunityRef] as Record<string, unknown>) : null
            const apolloCollectionName = planCommunityObj ? String(planCommunityObj?.name || "") : ""

            const relUrl = String(h?.url || "")
            const hasOwnUrl = relUrl.startsWith("/")
            const sourceUrl = hasOwnUrl ? `${BASE}${relUrl}` : (relUrl || pageUrl)

            results.push({
              address:    String(h.address),
              price:      typeof h.price === "number" ? h.price : undefined,
              sqft:       typeof h.sqft  === "number" ? h.sqft  : (plan ? Number(plan.sqft)  || undefined : undefined),
              beds:       typeof h.beds  === "number" ? h.beds  : (plan ? Number(plan.beds)  || undefined : undefined),
              baths:      typeof h.baths === "number"
                ? (h.baths as number) + (typeof h.halfBaths === "number" ? (h.halfBaths as number) * 0.5 : 0)
                : undefined,
              planName:   plan ? String(plan.name || "") || undefined : undefined,
              sourceUrl, hasOwnUrl,
              status:     String(h?.status || "").toUpperCase(),
              lotNumber:  h?.number ? String(parseInt(String(h.number), 10)) : undefined,
              lotId:      h?.lotid  ? String(h.lotid) : undefined,
              apolloCollectionName,
            })
          }
          return results
        }, communityUrl)

        console.log(`  [Lennar] Nova: ${novaListings.length} total homesites`)

        // Pre-filter by collection
        let listingsToProcess = novaListings
        if (collectionFilter) {
          const keyword = collectionFilter.toLowerCase().split(/[\s(]/)[0]
          const byCollection = novaListings.filter(r => {
            const collName = r.apolloCollectionName.toLowerCase()
            if (collName && collName.includes(keyword)) return true
            if (r.hasOwnUrl) {
              const u = r.sourceUrl.toLowerCase()
              if (u.includes(`/${keyword}-`) || u.includes(`/${keyword}/`)) return true
            }
            return false
          })
          if (byCollection.length > 0) {
            console.log(`  [Lennar] Filter "${collectionFilter}": ${byCollection.length}/${novaListings.length}`)
            listingsToProcess = byCollection
          }
        }

        // GeoJSON augmentation: add future-release lots not yet in Apollo state
        {
          const prefixCounts: Record<string, number> = {}
          for (const r of listingsToProcess) {
            if (r.lotId && r.lotId.length >= 6) {
              const p = r.lotId.substring(0, 6)
              prefixCounts[p] = (prefixCounts[p] || 0) + 1
            }
          }
          const collectionPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

          if (collectionPrefix) {
            const geoLotIds = await extractGeoJsonLotIds(page, collectionPrefix)
            const apolloLotIdSet = new Set(listingsToProcess.map(r => r.lotId).filter(Boolean))
            const phantomIds = geoLotIds.filter(id => !apolloLotIdSet.has(id))

            console.log(
              `  [Lennar] GeoJSON: ${geoLotIds.length} lots (prefix ${collectionPrefix})` +
              ` | Apollo: ${apolloLotIdSet.size} | future: ${phantomIds.length}`
            )

            for (const lotId of phantomIds) {
              const lotNumber = String(parseInt(lotId.slice(-4), 10))
              const syntheticAddress = `Lot ${lotNumber}`
              if (seenAddresses.has(syntheticAddress)) continue
              seenAddresses.add(syntheticAddress)
              allListings.push({
                communityName: "",
                communityUrl,
                city: "",
                address: syntheticAddress,
                lotNumber,
                status: "future",
                sourceUrl: communityUrl,
              })
            }
          }
        }

        // Process Apollo listings
        for (const raw of listingsToProcess) {
          const address = cleanAddress(raw.address)
          if (!address || seenAddresses.has(address)) continue
          seenAddresses.add(address)

          // Lennar status mapping — status string is the ground truth:
          // - SOLD / CLOSED                        → sold
          // - UNDER_CONSTRUCTION / MOVE_IN_READY   → active (for sale, must have price)
          // - UNDEFINED / COMING_SOON / MODEL_HOME → future (not yet released)
          // - any unknown status                   → future
          const knownStatuses = new Set(["SOLD","CLOSED","UNDEFINED","MOVE_IN_READY","UNDER_CONSTRUCTION","MODEL_HOME","COMING_SOON"])
          if (!knownStatuses.has(raw.status)) {
            console.warn(`[Lennar] Unknown homesite status "${raw.status}" for ${raw.address} — treated as future`)
          }
          const listingStatus: "active" | "sold" | "future" =
            (raw.status === "SOLD" || raw.status === "CLOSED")                                   ? "sold"   :
            (raw.status === "UNDER_CONSTRUCTION" || raw.status === "MOVE_IN_READY") && raw.price ? "active" :
                                                                                                    "future"

          let moveInDate: string | undefined
          if (raw.status === "MOVE_IN_READY")          moveInDate = "Move-In Ready"
          else if (raw.status === "UNDER_CONSTRUCTION") moveInDate = "Under Construction"

          let pd: Awaited<ReturnType<typeof scrapeLennarPropertyDetails>> = {}
          if (raw.hasOwnUrl && listingStatus === "active") {
            console.log(`  [Lennar] Details: ${raw.sourceUrl}`)
            pd = await scrapeLennarPropertyDetails(page, raw.sourceUrl)
            moveInDate = moveInDate || pd.moveInDate
            await page.waitForTimeout(randomDelayMs(300, 800))
          }

          const price = listingStatus === "active" ? raw.price : undefined
          const sqft  = raw.sqft ?? pd.sqft

          allListings.push({
            communityName: "",  // filled by applySheetDefaults
            communityUrl,
            city: "",           // filled by applySheetDefaults
            address,
            lotNumber: pd.lotNumber || raw.lotNumber,
            floorPlan: raw.planName,
            sqft,
            beds:  pd.beds  ?? raw.beds,
            baths: pd.baths ?? raw.baths,
            garages: pd.garages,
            floors: lennarPlanFloors(raw.planName) ?? pd.floors,
            price,
            pricePerSqft: price && sqft ? Math.round(price / sqft) : undefined,
            propertyType: pd.propertyType || "",
            hoaFees: pd.hoaFees,
            taxes: pd.taxRate && price ? Math.round(price * pd.taxRate / 100) : undefined,
            moveInDate,
            sourceUrl: raw.sourceUrl,
            status: listingStatus,
          })
        }
      } else {
        // ── Old Apollo schema ────────────────────────────────────────────
        const homesites = await extractApolloHomesites(page)
        const active = homesites.filter(h => {
          const s = h.status.toUpperCase()
          return s === "UNDER_CONSTRUCTION" || s === "MOVE_IN_READY"
        })
        console.log(`  [Lennar] Old schema: ${homesites.length} total, ${active.length} active`)

        for (const raw of active) {
          const addr = cleanAddress(raw.address)
          if (!addr || seenAddresses.has(addr)) continue
          seenAddresses.add(addr)

          const baths = raw.baths + raw.halfBaths * 0.5
          const collectionSlug = raw.communityName.toLowerCase().replace(/\s+/g, "-")
          const planSlug = raw.planName.toLowerCase().replace(/\s+/g, "-")
          const citySlug = raw.city.toLowerCase().replace(/\s+/g, "-")
          const mpcSlug  = raw.mpcName.toLowerCase().replace(/\s+/g, "-")

          let detailUrl = buildDetailUrl(raw)
          if (!detailUrl && raw.lotId && citySlug && mpcSlug) {
            detailUrl = `${BASE_URL}/new-homes/california/orange-county/${citySlug}/${mpcSlug}/${collectionSlug}/${planSlug}/${raw.lotId}`
          }

          let moveInDate: string | undefined
          const su = raw.status.toUpperCase()
          if (su === "MOVE_IN_READY" || su.includes("READY")) moveInDate = "Move-In Ready"
          else if (su.includes("CONSTRUCTION")) moveInDate = "Under Construction"
          else if (su === "COMING_SOON" || su.includes("COMING")) moveInDate = "Coming Soon"

          let pd: Awaited<ReturnType<typeof scrapeLennarPropertyDetails>> = {}
          if (detailUrl) {
            pd = await scrapeLennarPropertyDetails(page, detailUrl)
            moveInDate = moveInDate || pd.moveInDate
            await page.waitForTimeout(randomDelayMs(300, 800))
          }

          const finalSqft = pd.sqft || raw.sqft || undefined
          allListings.push({
            communityName: buildCommunityName(raw.mpcName, raw.communityName),
            communityUrl,
            city: pd.cityFromPD || raw.city,
            address: addr,
            lotNumber: pd.lotNumber || raw.lotNumber || undefined,
            floorPlan: raw.planName || undefined,
            sqft: finalSqft,
            beds: pd.beds || raw.beds || undefined,
            baths: pd.baths || baths || undefined,
            garages: pd.garages,
            floors: lennarPlanFloors(raw.planName) ?? pd.floors ?? parseFloors(raw.planName),
            price: raw.price,
            pricePerSqft: raw.price && finalSqft ? Math.round(raw.price / finalSqft) : undefined,
            propertyType: pd.propertyType || "",
            hoaFees: pd.hoaFees,
            taxes: pd.taxRate && raw.price ? Math.round(raw.price * pd.taxRate / 100) : undefined,
            moveInDate,
            sourceUrl: detailUrl || communityUrl,
          })
        }
      }
    }
  } finally {
    await browser.close()
  }

  return allListings
}
