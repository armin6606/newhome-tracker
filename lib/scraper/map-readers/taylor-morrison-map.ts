/**
 * taylor-morrison-map.ts
 *
 * Playwright-based map reader for Taylor Morrison interactive site plan.
 * Navigates to the community page, finds the homesite map section,
 * and counts lots by status.
 *
 * Status detection uses class names, data attributes, and color indicators.
 * No price = future (no-price rule enforced).
 */

import { chromium, type Response } from "playwright"
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
    console.log(`[TaylorMorrison] Loading: ${url}`)
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    // Try to activate the site plan / homesites tab
    const tabSelectors = [
      'a:has-text("Site Plan")',
      'a:has-text("Homesites")',
      'a:has-text("Available Homes")',
      'button:has-text("Site Plan")',
      'button:has-text("Homesite")',
      '[class*="sitePlan"] a',
      '[data-tab="siteplan"]',
      '[data-tab="homesites"]',
    ]
    for (const sel of tabSelectors) {
      try {
        const el = page.locator(sel).first()
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click()
          await page.waitForTimeout(randomDelayMs(1500, 3000))
          break
        }
      } catch {
        // not found, continue
      }
    }

    await page.waitForTimeout(randomDelayMs(1000, 2000))

    // Intercept any JSON lot/homesite data from network responses
    const apiLots: Array<{
      id?: unknown
      number?: unknown
      lotNumber?: unknown
      status?: string
      price?: number | null
      listPrice?: number | null
    }> = []
    let apiIntercepted = false

    page.on("response", async (response: Response) => {
      const resUrl = response.url()
      if (
        resUrl.includes("homesite") ||
        resUrl.includes("lot") ||
        resUrl.includes("inventory") ||
        resUrl.includes("siteplan")
      ) {
        try {
          const ct = response.headers()["content-type"] || ""
          if (ct.includes("json")) {
            const json = await response.json().catch(() => null)
            if (!json) return
            const arr = Array.isArray(json)
              ? json
              : Array.isArray(json?.homesites)
              ? json.homesites
              : Array.isArray(json?.lots)
              ? json.lots
              : Array.isArray(json?.data)
              ? json.data
              : []
            if (arr.length > 0) {
              apiLots.push(
                ...arr.filter(
                  (i: unknown) => typeof i === "object" && i !== null
                )
              )
              apiIntercepted = true
            }
          }
        } catch {
          // ignore
        }
      }
    })

    // Scroll to trigger lazy-loaded map
    await page.evaluate(() => {
      const mapEl =
        document.querySelector('[class*="sitePlan"]') ||
        document.querySelector('[class*="siteplan"]') ||
        document.querySelector('[id*="siteplan"]') ||
        document.querySelector('[id*="site-plan"]')
      if (mapEl) mapEl.scrollIntoView()
    })
    await page.waitForTimeout(randomDelayMs(2000, 3000))

    if (apiIntercepted && apiLots.length > 0) {
      console.log(
        `[TaylorMorrison] ${communityName}: API data — ${apiLots.length} lots`
      )

      const lots: MapLot[] = apiLots.map((lot, i) => {
        const lotNum = String(lot.number ?? lot.lotNumber ?? lot.id ?? `lot-${i + 1}`)
        const price =
          (typeof lot.price === "number" && lot.price > 0 ? lot.price : null) ??
          (typeof lot.listPrice === "number" && lot.listPrice > 0
            ? lot.listPrice
            : null) ??
          undefined

        const s = (lot.status || "").toLowerCase()
        let status: "active" | "sold" | "future"
        if (
          s.includes("sold") ||
          s.includes("closed") ||
          s.includes("contract")
        ) {
          status = "sold"
        } else if (s.includes("available") || s.includes("active")) {
          status = price ? "active" : "future"
        } else {
          status = "future"
        }

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
      console.log(
        `[TaylorMorrison] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`
      )
      return { sold, forSale, future, total, lots }
    }

    // Fallback: DOM-based counting
    const domResult = await page.evaluate(() => {
      const processedIds = new Set<string>()
      let sold = 0
      let forSale = 0
      let total = 0

      // Taylor Morrison uses homesite cards and/or SVG map
      const candidates = Array.from(
        document.querySelectorAll(
          "[class*='HomeCard'], [class*='homecard'], [class*='homesite'], " +
            "[class*='lot-card'], [data-homesite], [data-lot], " +
            "svg [data-status], svg g[id*='lot'], svg g[id*='hs']"
        )
      )

      for (const el of candidates) {
        const id =
          el.getAttribute("id") ||
          el.getAttribute("data-homesite") ||
          el.getAttribute("data-lot") ||
          `${el.tagName}-${(el as HTMLElement).innerText?.slice(0, 20)}`

        if (processedIds.has(id)) continue
        processedIds.add(id)

        // Must have a number to count as a lot
        const numText =
          el.getAttribute("data-lot-number") ||
          el.getAttribute("data-homesite-number") ||
          el.getAttribute("data-lot") ||
          (el as HTMLElement).innerText?.match(/\d+/)?.[0] ||
          ""
        if (!/\d/.test(numText)) continue

        total++

        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (
          el.getAttribute("data-status") ||
          el.getAttribute("data-homesite-status") ||
          ""
        ).toLowerCase()
        const combined = classStr + " " + dataStatus

        if (
          combined.includes("sold") ||
          combined.includes("closed") ||
          combined.includes("contract")
        ) {
          sold++
        } else if (
          combined.includes("available") ||
          combined.includes("active")
        ) {
          // Only count as forSale if there's a price indicator
          const priceAttr =
            el.getAttribute("data-price") ||
            el.querySelector("[class*='price']")?.textContent
          if (priceAttr && /\d/.test(priceAttr)) forSale++
          // else: future
        }
      }

      return { sold, forSale, total }
    })

    const total = domResult.total
    const sold = domResult.sold
    const forSale = domResult.forSale
    const future = Math.max(0, total - sold - forSale)

    console.log(
      `[TaylorMorrison] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`
    )
    return { sold, forSale, future, total }
  } finally {
    await browser.close()
  }
}
