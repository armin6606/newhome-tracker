/**
 * melia-map.ts
 *
 * Playwright-based map reader for Melia Homes interactive site plan.
 * Status detection:
 *   - Red circle lots   → sold
 *   - Green circle lots → for sale (active)
 *   - All numbered lots that are neither → future
 *
 * Total = all numbered lots
 * Sold  = red circle lots
 * For Sale = green circle lots
 * Future = Total - Sold - For Sale
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

export async function readMeliaMap(
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
    console.log(`[Melia] Loading map: ${url}`)
    await page.goto(url, { waitUntil: "load", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    // Try to navigate to the site plan section
    const sitePlanSelectors = [
      'a:has-text("Site Plan")',
      'a:has-text("Homesites")',
      'a:has-text("Available Homes")',
      'button:has-text("Site Plan")',
      '[class*="sitePlan"]',
      '[class*="site-plan"]',
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

    await page.waitForTimeout(randomDelayMs(1000, 2000))

    const rawLots = await page.evaluate(() => {
      const processedIds = new Set<string>()
      const results: Array<{ lotNumber: string; status: string }> = []

      // Check all SVG and DOM elements for lot indicators
      const candidates = Array.from(
        document.querySelectorAll(
          "svg circle, svg g[id], svg path[id], " +
            "[class*='homesite'], [class*='lot'], [data-homesite], [data-lot]"
        )
      )

      const isRedColor = (el: Element): boolean => {
        const fill = el.getAttribute("fill") || ""
        const style = (el as HTMLElement).style?.backgroundColor || ""
        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (el.getAttribute("data-status") || "").toLowerCase()
        if (
          classStr.includes("sold") ||
          classStr.includes("unavailable") ||
          dataStatus.includes("sold")
        )
          return true
        if (
          fill.match(/^#[cCdDeEfF][0-5][0-5]/) ||
          style.includes("rgb(") && style.match(/rgb\(2[0-4]\d|25[0-5]/)
        )
          return fill.toLowerCase().startsWith("#e") || fill.toLowerCase().startsWith("#f") || fill.toLowerCase().startsWith("#d")
        return (
          fill.toLowerCase().includes("red") ||
          fill.match(/#[cCdDeEfF][0-4][0-4][0-9a-fA-F]{0,3}$/) !== null
        )
      }

      const isGreenColor = (el: Element): boolean => {
        const fill = el.getAttribute("fill") || ""
        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (el.getAttribute("data-status") || "").toLowerCase()
        if (
          classStr.includes("available") ||
          classStr.includes("active") ||
          classStr.includes("for-sale") ||
          dataStatus.includes("available") ||
          dataStatus.includes("active")
        )
          return true
        return (
          fill.toLowerCase().includes("green") ||
          fill.match(/#[0-9a-fA-F]{0,2}[7-9a-fA-F][0-9a-fA-F]{2,3}[0-4][0-9a-fA-F]$/) !== null
        )
      }

      for (const el of candidates) {
        const id =
          el.getAttribute("id") ||
          el.getAttribute("data-lot") ||
          el.getAttribute("data-homesite") ||
          `${el.tagName}-${el.className}-${el.textContent?.trim().slice(0, 10)}`

        if (processedIds.has(id)) continue
        processedIds.add(id)

        // Extract the numeric lot number from any available attribute
        const rawNum =
          el.getAttribute("data-lot") ||
          el.getAttribute("data-homesite") ||
          el.getAttribute("data-lot-number") ||
          el.id ||
          el.textContent?.trim() ||
          ""
        const numMatch = rawNum.trim().match(/\d+/)
        if (!numMatch) continue
        const lotNumber = numMatch[0]

        let status: string
        if (isRedColor(el)) status = "sold"
        else if (isGreenColor(el)) status = "for sale"
        else status = "future"

        results.push({ lotNumber, status })
      }

      return results
    })

    const lots: MapLot[] = rawLots.map((l) => ({
      lotNumber: l.lotNumber,
      status: l.status as "for sale" | "sold" | "future",
    }))

    const sold    = lots.filter((l) => l.status === "sold").length
    const forSale = lots.filter((l) => l.status === "for sale").length
    const future  = lots.filter((l) => l.status === "future").length
    const total   = lots.length

    console.log(
      `[Melia] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`
    )

    return { sold, forSale, future, total, lots }
  } finally {
    await browser.close()
  }
}
