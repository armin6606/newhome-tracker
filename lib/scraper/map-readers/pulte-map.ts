/**
 * pulte-map.ts
 *
 * Playwright-based map reader for Pulte (AlphaVision iframe) interactive site plan.
 *
 * Strategy:
 * 1. Navigate to community URL
 * 2. Find the AlphaVision iframe
 * 3. Open iframe src in new page
 * 4. Intercept network responses — look for JSON with lot objects containing lot number + status
 * 5. If API interception works: parse lot objects directly
 * 6. If not: count by unique lot ID elements
 * 7. No price = future
 */

import { chromium, type Page, type Response } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

interface AlphaVisionLot {
  id?: string | number
  lotNumber?: string | number
  lotNum?: string | number
  number?: string | number
  status?: string
  statusId?: number
  price?: number | null
  listPrice?: number | null
}

/** Known AlphaVision/Pulte status codes → normalized status */
function normalizeAlphaStatus(
  status: string | undefined,
  statusId: number | undefined,
  price: number | null | undefined
): "active" | "sold" | "future" {
  const s = (status || "").toLowerCase()
  const id = statusId ?? -1

  if (
    s.includes("sold") ||
    s.includes("closed") ||
    s.includes("contract") ||
    id === 3 ||
    id === 4 ||
    id === 5
  ) {
    return "sold"
  }
  if (s.includes("available") || s.includes("active") || id === 1) {
    // No price → future (no-price rule)
    if (!price || price <= 0) return "future"
    return "active"
  }
  // Not released, pending, model, spec — treat as future
  return "future"
}

async function readAlphaVisionIframe(
  page: Page,
  iframeSrc: string,
  communityName: string
): Promise<MapResult> {
  const apiLots: AlphaVisionLot[] = []
  let apiIntercepted = false

  // Open iframe src in the same page (new navigation)
  const iframePage = await page.context().newPage()

  // Intercept API responses
  iframePage.on("response", async (response: Response) => {
    const url = response.url()
    // AlphaVision API endpoints commonly contain "lots", "homesites", "inventory"
    if (
      url.includes("lots") ||
      url.includes("homesites") ||
      url.includes("inventory") ||
      url.includes("siteplan") ||
      url.includes("site-plan")
    ) {
      try {
        const contentType = response.headers()["content-type"] || ""
        if (contentType.includes("json")) {
          const json = await response.json().catch(() => null)
          if (!json) return

          // Try to extract lot array from various response shapes
          const candidates: unknown[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.lots)
            ? json.lots
            : Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json?.homesites)
            ? json.homesites
            : Array.isArray(json?.results)
            ? json.results
            : []

          if (candidates.length > 0) {
            const typedLots = candidates as AlphaVisionLot[]
            // Validate that items look like lots (have some lot-ish fields)
            const looksLikeLots = typedLots.some(
              (l) =>
                l.lotNumber !== undefined ||
                l.lotNum !== undefined ||
                l.number !== undefined ||
                l.status !== undefined ||
                l.statusId !== undefined
            )
            if (looksLikeLots) {
              apiLots.push(...typedLots)
              apiIntercepted = true
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  })

  try {
    console.log(`[Pulte] Loading AlphaVision iframe: ${iframeSrc}`)
    await iframePage.goto(iframeSrc, {
      waitUntil: "networkidle",
      timeout: 60000,
    })
    await iframePage.waitForTimeout(randomDelayMs(2000, 4000))

    if (apiIntercepted && apiLots.length > 0) {
      console.log(
        `[Pulte] ${communityName}: API interception succeeded — ${apiLots.length} lots`
      )

      const lots: MapLot[] = apiLots.map((lot, i) => {
        const lotNum = String(
          lot.lotNumber ?? lot.lotNum ?? lot.number ?? lot.id ?? `lot-${i + 1}`
        )
        const price =
          (typeof lot.price === "number" && lot.price > 0
            ? lot.price
            : null) ??
          (typeof lot.listPrice === "number" && lot.listPrice > 0
            ? lot.listPrice
            : null) ??
          undefined
        const status = normalizeAlphaStatus(lot.status, lot.statusId, price)

        return {
          lotNumber: lotNum,
          status,
          price: status === "active" ? price : undefined,
        } satisfies MapLot
      })

      const sold = lots.filter((l) => l.status === "sold").length
      const forSale = lots.filter((l) => l.status === "active").length
      const future = lots.filter((l) => l.status === "future").length
      const total = lots.length

      return { sold, forSale, future, total, lots }
    }

    // Fallback: count by DOM lot elements
    console.log(
      `[Pulte] ${communityName}: No API data — falling back to DOM counting`
    )
    const domResult = await iframePage.evaluate(() => {
      const processedIds = new Set<string>()
      let sold = 0
      let forSale = 0
      let allLots = 0

      // AlphaVision renders lots as SVG elements with unique IDs like "lot_123" or "hs_45"
      const candidates = Array.from(
        document.querySelectorAll(
          "[id^='lot_'], [id^='hs_'], [id^='homesite_'], [data-lot-id], [data-homesite-id], " +
            "svg g[id*='lot'], svg path[id*='lot']"
        )
      )

      for (const el of candidates) {
        const id = el.id || el.getAttribute("data-lot-id") || el.getAttribute("data-homesite-id") || ""
        if (!id || processedIds.has(id)) continue

        // Validate it's a numbered lot element (not a UI button or label)
        if (!/\d/.test(id)) continue
        processedIds.add(id)
        allLots++

        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (
          el.getAttribute("data-status") ||
          el.getAttribute("data-lot-status") ||
          ""
        ).toLowerCase()
        const combined = classStr + " " + dataStatus

        if (combined.includes("sold") || combined.includes("closed") || combined.includes("contract")) {
          sold++
        } else if (combined.includes("available") || combined.includes("active")) {
          // Check if it has a price indicator; without price = future
          const hasPrice = !!(el.getAttribute("data-price") || el.getAttribute("data-list-price"))
          if (hasPrice) forSale++
          // else: neither sold nor forSale → future (counted at the end)
        }
      }

      return { sold, forSale, total: allLots }
    })

    const total = domResult.total
    const sold = domResult.sold
    const forSale = domResult.forSale
    const future = Math.max(0, total - sold - forSale)

    console.log(
      `[Pulte] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`
    )
    return { sold, forSale, future, total }
  } finally {
    await iframePage.close()
  }
}

export async function readPulteMap(
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
    console.log(`[Pulte] Loading community page: ${url}`)
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 3000))

    // Find AlphaVision iframe src
    const iframeSrc = await page.evaluate(() => {
      const selectors = [
        'iframe[src*="zondavirtual"]',
        'iframe[src*="alphamap"]',
        'iframe[src*="alphavision"]',
        '#AlphaVisionMapIframe',
        'iframe[id*="AlphaVision"]',
        'iframe[class*="alpha"]',
      ]
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLIFrameElement | null
        if (el?.src) return el.src
      }
      // Last resort: any iframe that might be a map
      const iframes = Array.from(document.querySelectorAll("iframe"))
      for (const iframe of iframes) {
        const src = iframe.src || ""
        if (
          src.includes("map") ||
          src.includes("siteplan") ||
          src.includes("homesite")
        ) {
          return src
        }
      }
      return null
    })

    if (!iframeSrc) {
      console.log(`[Pulte] ${communityName}: No AlphaVision iframe found — skipping`)
      return { sold: 0, forSale: 0, future: 0, total: 0 }
    }

    return await readAlphaVisionIframe(page, iframeSrc, communityName)
  } finally {
    await browser.close()
  }
}
