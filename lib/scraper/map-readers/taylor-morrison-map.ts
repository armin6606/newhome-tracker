/**
 * taylor-morrison-map.ts
 *
 * Playwright-based map reader for Taylor Morrison community pages.
 *
 * Taylor Morrison redesigned their site (May 2026):
 *  - Removed the homesite JSON API entirely
 *  - All available homes are now server-rendered as `.tm-home-card` elements
 *  - The `/available-homes` sub-page is the cleanest source
 *
 * Status mapping:
 *  - "Ready Now"             → for sale
 *  - "This home is reserved" → for sale (reserved but still listed with a price)
 *  - Sold homes don't appear on this page — detected by disappearance from list
 *
 * Returns qmiOnly: true so the scraper skips the 50% lot-count safety guard
 * (the available-homes page only shows active listings, not all lots).
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

export async function readTaylorMorrisonMap(
  url: string,
  communityName: string
): Promise<MapResult> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  try {
    // ── Navigate to /available-homes sub-page ─────────────────────────────────
    const availableUrl = url.replace(/\/$/, "") + "/available-homes"
    console.log(`[TaylorMorrison] Loading: ${availableUrl}`)
    await page.goto(availableUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    // ── New DOM structure: .tm-home-card ─────────────────────────────────────
    const cardCount = await page.locator(".tm-home-card").count()
    console.log(`[TaylorMorrison] ${communityName}: ${cardCount} tm-home-card elements`)

    if (cardCount > 0) {
      const rawLots = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".tm-home-card"))
        const seen  = new Set<string>()

        const results: Array<{
          lotNumber?: string
          address?:   string
          floorPlan?: string
          price?:     number
          beds?:      number
          baths?:     number
          sqft?:      number
          garages?:   number
          status:     string
        }> = []

        for (const card of cards) {
          const el = card as HTMLElement

          const statusText = (el.querySelector(".tm-home-card__status-label") as HTMLElement)?.innerText?.trim() || ""
          const fp         = (el.querySelector(".tm-home-card__info--address-fp") as HTMLElement)?.innerText?.trim() || undefined
          const addr       = (el.querySelector(".tm-home-card__info--address-full") as HTMLElement)?.innerText?.trim() || undefined
          const priceText  = (el.querySelector(".tm-home-card__info--price-cur") as HTMLElement)?.innerText?.trim() || ""

          // Lot number from card text, e.g. "Lot 35"
          const lotMatch  = el.innerText?.match(/Lot\s+(\d+)/i)
          const lotNumber = lotMatch ? lotMatch[1] : undefined

          // Dedup by address + lot
          const key = (addr || "") + "|" + (lotNumber || "")
          if (seen.has(key)) continue
          seen.add(key)

          // Price — strip $, commas
          const priceNum = priceText ? parseInt(priceText.replace(/[^0-9]/g, ""), 10) : NaN
          const price    = !isNaN(priceNum) && priceNum > 0 ? priceNum : undefined

          // Features: Beds / Baths / Sq.Ft. / Garage
          let beds: number | undefined, baths: number | undefined
          let sqft: number | undefined, garages: number | undefined

          for (const feat of Array.from(el.querySelectorAll(".tm-home-card__features--item"))) {
            const text  = (feat as HTMLElement).innerText?.trim() || ""
            const lower = text.toLowerCase()
            const num   = parseFloat(text.replace(/[^0-9.]/g, ""))
            if (isNaN(num)) continue
            if      (lower.includes("bed"))  beds    = num
            else if (lower.includes("bath")) baths   = num
            else if (lower.includes("sq"))   sqft    = Math.round(num)
            else if (lower.includes("gar"))  garages = num
          }

          results.push({ lotNumber, address: addr, floorPlan: fp, price, beds, baths, sqft, garages, status: statusText })
        }

        return results
      })

      // All tm-home-card entries are active (for sale) listings
      const lots: MapLot[] = rawLots.map((raw, i) => ({
        lotNumber: raw.lotNumber ?? `lot-${i + 1}`,
        address:   raw.address,
        floorPlan: raw.floorPlan,
        price:     raw.price,
        beds:      raw.beds,
        baths:     raw.baths,
        sqft:      raw.sqft,
        garages:   raw.garages,
        status:    "for sale" as const,
      }))

      const forSale = lots.length
      console.log(`[TaylorMorrison] ${communityName}: forSale=${forSale} (available-homes DOM)`)
      return { sold: 0, forSale, future: 0, total: forSale, lots, qmiOnly: true }
    }

    // ── Fallback: try API interception on main community page ─────────────────
    // Kept in case any community still uses the old React SPA format
    console.log(`[TaylorMorrison] ${communityName}: No tm-home-card found on /available-homes — trying API fallback`)

    const apiLots: Array<{
      id?: unknown; number?: unknown; lotNumber?: unknown
      status?: string; price?: number | null; listPrice?: number | null
    }> = []
    let apiIntercepted = false

    page.on("response", async (response) => {
      const resUrl = response.url()
      if (
        resUrl.includes("homesite") || resUrl.includes("lot") ||
        resUrl.includes("inventory") || resUrl.includes("siteplan") ||
        resUrl.includes("site-plan") || resUrl.includes("availab")
      ) {
        try {
          const ct = response.headers()["content-type"] || ""
          if (!ct.includes("json")) return
          const json = await response.json().catch(() => null)
          if (!json) return
          const arr = Array.isArray(json) ? json
            : Array.isArray(json?.homesites) ? json.homesites
            : Array.isArray(json?.lots)      ? json.lots
            : Array.isArray(json?.data)      ? json.data
            : Array.isArray(json?.results)   ? json.results
            : []
          if (arr.length > 0) {
            apiLots.push(...arr.filter((i: unknown) => typeof i === "object" && i !== null))
            apiIntercepted = true
            console.log(`[TaylorMorrison] ${communityName}: intercepted ${arr.length} lots from ${resUrl}`)
          }
        } catch { /* ignore */ }
      }
    })

    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))
    await page.waitForLoadState("networkidle").catch(() => {})

    if (apiIntercepted && apiLots.length > 0) {
      const lots: MapLot[] = apiLots.map((lot, i) => {
        const lotNum = String(lot.number ?? lot.lotNumber ?? lot.id ?? `lot-${i + 1}`)
        const price  =
          (typeof lot.price     === "number" && lot.price     > 0 ? lot.price     : null) ??
          (typeof lot.listPrice === "number" && lot.listPrice > 0 ? lot.listPrice : null) ??
          undefined
        const s = (lot.status || "").toLowerCase()
        const status: "for sale" | "sold" | "future" =
          s.includes("sold") || s.includes("closed") || s.includes("contract") ? "sold"     :
          s.includes("available") || s.includes("active")                       ? (price ? "for sale" : "future") :
                                                                                   "future"
        return { lotNumber: lotNum, status, price: status === "for sale" ? price : undefined }
      })

      const sold    = lots.filter(l => l.status === "sold").length
      const forSale = lots.filter(l => l.status === "for sale").length
      const future  = lots.filter(l => l.status === "future").length
      const total   = lots.length
      console.log(`[TaylorMorrison] ${communityName}: API fallback total=${total} sold=${sold} forSale=${forSale} future=${future}`)
      return { sold, forSale, future, total, lots }
    }

    console.log(`[TaylorMorrison] ${communityName}: No data found`)
    return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: true }

  } finally {
    await browser.close()
  }
}
