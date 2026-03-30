/**
 * kb-home-map.ts
 *
 * Playwright-based map reader for KB Home interactive site plan.
 * Status detection:
 *   - Red circle lots  → sold
 *   - Blue circle lots → for sale (active)
 *   - All numbered lots that are neither → future
 *
 * Total = all numbered lots
 * Sold  = red circle lots
 * For Sale = blue circle lots
 * Future = Total - Sold - For Sale
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

export async function readKBHomeMap(
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
    console.log(`[KBHome] Loading map: ${url}`)
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    // Try to click into the site plan / homesite map section
    const sitePlanSelectors = [
      'a:has-text("Site Plan")',
      'a:has-text("Homesites")',
      'button:has-text("Site Plan")',
      'button:has-text("Homesite")',
      '[class*="sitePlan"]',
      '[class*="site-plan"]',
      '[data-tab="siteplan"]',
    ]
    for (const sel of sitePlanSelectors) {
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

    // Wait for lot elements to appear
    await page.waitForTimeout(randomDelayMs(1000, 2000))

    const result = await page.evaluate(() => {
      // KB Home uses circle/dot elements on a map SVG or overlay
      // Look for lot number labels and status indicators

      // Strategy 1: SVG-based lot elements
      const svgLots = Array.from(
        document.querySelectorAll(
          "svg [data-lot], svg [data-homesite], svg circle[class*='lot'], svg g[data-status]"
        )
      )

      // Strategy 2: DOM-based homesite cards or list items
      const domLots = Array.from(
        document.querySelectorAll(
          "[class*='homesite'], [class*='lot-item'], [class*='lotItem'], [data-homesite-number]"
        )
      )

      // Strategy 3: look for any element with a lot number and color indicator
      const anyLotEls = Array.from(
        document.querySelectorAll(
          "[data-lot-number], [data-lot-id], [class*='LotPin'], [class*='lotPin'], [class*='lot-pin']"
        )
      )

      let sold = 0
      let forSale = 0
      let allNumberedLots = 0

      const processedIds = new Set<string>()

      function getStatusFromEl(el: Element): "sold" | "forSale" | "unknown" {
        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (
          el.getAttribute("data-status") ||
          el.getAttribute("data-lot-status") ||
          ""
        ).toLowerCase()
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase()
        const combined = classStr + " " + dataStatus + " " + ariaLabel

        if (
          combined.includes("sold") ||
          combined.includes("closed") ||
          combined.includes("unavailable")
        ) {
          return "sold"
        }
        if (
          combined.includes("available") ||
          combined.includes("active") ||
          combined.includes("for-sale") ||
          combined.includes("forsale") ||
          combined.includes("open")
        ) {
          return "forSale"
        }

        // Check fill/background color for red (sold) or blue (for sale)
        const style = (el as HTMLElement).style
        const fill =
          el.getAttribute("fill") ||
          style?.backgroundColor ||
          style?.fill ||
          ""
        // Red variants → sold
        if (/^#?[Ee][0-9a-fA-F]{1,5}$/.test(fill) || fill.includes("red") || fill.includes("e53"))
          return "sold"
        // Blue variants → for sale
        if (fill.includes("blue") || fill.includes("007") || fill.includes("00b") || fill.includes("0050"))
          return "forSale"

        return "unknown"
      }

      function hasLotNumber(el: Element): boolean {
        const lotNum =
          el.getAttribute("data-lot") ||
          el.getAttribute("data-lot-number") ||
          el.getAttribute("data-homesite-number") ||
          el.getAttribute("data-homesite") ||
          el.textContent?.trim() ||
          ""
        return /^\d+$/.test(lotNum.trim())
      }

      const allEls = [...svgLots, ...domLots, ...anyLotEls]

      for (const el of allEls) {
        const id =
          el.getAttribute("id") ||
          el.getAttribute("data-lot") ||
          el.getAttribute("data-lot-number") ||
          `${el.tagName}-${el.className}-${el.textContent?.trim().slice(0, 10)}`

        if (processedIds.has(id)) continue
        processedIds.add(id)

        if (!hasLotNumber(el)) continue
        allNumberedLots++

        const status = getStatusFromEl(el)
        if (status === "sold") sold++
        else if (status === "forSale") forSale++
      }

      return { sold, forSale, total: allNumberedLots }
    })

    const total = result.total
    const sold = result.sold
    const forSale = result.forSale
    const future = Math.max(0, total - sold - forSale)

    console.log(
      `[KBHome] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`
    )

    return { sold, forSale, future, total }
  } finally {
    await browser.close()
  }
}
