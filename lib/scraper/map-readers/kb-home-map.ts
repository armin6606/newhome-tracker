/**
 * kb-home-map.ts
 *
 * KB Home uses a third-party site plan platform: kb-vu.com (centravu®).
 * Each community page has an iframe whose data-src points to a kb-vu.com URL.
 *
 * This reader:
 *   1. Loads the KB Home community page and extracts the kb-vu.com iframe URL
 *   2. Navigates Playwright to that URL
 *   3. Reads individual lot data from the rendered DOM:
 *      - Teal   rgb(145,223,222) = Move-in ready  → for sale (has price + address)
 *      - Green  rgb(167,200,57)  = Pre-planned    → for sale (has price + address)
 *      - Orange rgb(241,93,34)   = Sold           → sold
 *      - Yellow rgb(255,193,7)   = Model home     → future (no price until released)
 *   4. Status rule: price + real address = "for sale", else = "future"
 *   5. Returns a MapResult with real lot-by-lot data (no placeholders needed)
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

const TEAL   = "rgb(145, 223, 222)"  // Move-in ready → for sale
const GREEN  = "rgb(167, 200, 57)"   // Pre-planned   → for sale
const ORANGE = "rgb(241, 93, 34)"    // Sold
const YELLOW = "rgb(255, 193, 7)"    // Model home    → future (no price)

export async function readKBHomeMap(
  communityUrl: string,
  communityName: string
): Promise<MapResult> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  try {
    // ── Step 1: load KB Home community page and extract kb-vu.com iframe URL ──
    console.log(`[KBHome] Loading community page: ${communityUrl}`)
    await page.goto(communityUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(1500, 2500))

    const vuUrl = await page.evaluate(() => {
      const iframe = document.querySelector("iframe.interactiveFP") as HTMLIFrameElement | null
      return iframe?.getAttribute("data-src") || null
    })

    if (!vuUrl) {
      console.warn(`[KBHome] ${communityName}: No kb-vu.com iframe found on community page`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [] }
    }

    // Clean the URL (strip trailing query params like ?nseFloorplanId=)
    const cleanVuUrl = vuUrl.split("?")[0]
    console.log(`[KBHome] ${communityName}: Loading site plan: ${cleanVuUrl}`)

    // ── Step 2: load the kb-vu.com site plan ──
    await page.goto(cleanVuUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 3500))

    // Wait for homesite circles to appear
    await page.waitForFunction(
      () => document.querySelectorAll("span, div").length > 50,
      { timeout: 15000 }
    ).catch(() => console.warn(`[KBHome] ${communityName}: Timeout waiting for circles`))

    await page.waitForTimeout(randomDelayMs(1000, 2000))

    // ── Step 3: extract all lot data ──
    const lots: MapLot[] = await page.evaluate(
      ({ TEAL, GREEN, ORANGE, YELLOW, communityName }) => {
        const seen = new Set<string>()
        const results: MapLot[] = []

        // Find all numbered circles with a status color
        const allEls = Array.from(document.querySelectorAll("span, div"))
        const circles = allEls.filter(el => {
          const bg = window.getComputedStyle(el).backgroundColor
          return (
            [TEAL, GREEN, ORANGE, YELLOW].includes(bg) &&
            /^\d+$/.test(el.textContent?.trim() || "")
          )
        })

        for (const el of circles) {
          const lotNum = el.textContent?.trim() || ""
          if (!lotNum || seen.has(lotNum)) continue
          seen.add(lotNum)

          const bg = window.getComputedStyle(el).backgroundColor
          // Orange = sold. All others (teal/green/yellow) = potentially active,
          // but yellow (model) has no price so buildListings will set it to future.
          const status: "for sale" | "sold" = bg === ORANGE ? "sold" : "for sale"

          // Walk up the DOM to find the card containing address + price
          let parent: Element | null = el.parentElement
          let cardText = ""
          for (let i = 0; i < 8; i++) {
            if (!parent) break
            const t = parent.textContent?.trim() || ""
            if (t.includes("$") && t.length < 300) {
              cardText = t.replace(/\s+/g, " ")
              break
            }
            parent = parent.parentElement
          }

          let address: string | undefined
          let price: number | undefined

          if (cardText) {
            // Pattern: "Homesite {lot}{streetNumber} {street...}${price}Home price"
            const m = cardText.match(new RegExp(`Homesite ${lotNum}(\\d{4,5}[^$]+?)\\$([0-9,]+)`))
            if (m) {
              address = m[1].trim()
              const parsedPrice = parseInt(m[2].replace(/,/g, ""), 10)
              // Reject placeholder prices (KB Home occasionally posts $10 or $1 for pending homes)
              price = parsedPrice >= 10_000 ? parsedPrice : undefined
            }
          }

          results.push({
            lotNumber: lotNum,
            status,
            address,
            price: status === "for sale" ? price : undefined,
          })
        }

        return results
      },
      { TEAL, GREEN, ORANGE, YELLOW, communityName }
    )

    const active = lots.filter(l => l.status === "for sale")
    const sold   = lots.filter(l => l.status === "sold")

    console.log(
      `[KBHome] ${communityName}: total=${lots.length} active=${active.length} sold=${sold.length}`
    )

    return {
      sold:    sold.length,
      forSale: active.length,
      future:  0,   // KB Home shows no future lots on kb-vu.com
      total:   lots.length,
      lots,
    }
  } finally {
    await browser.close()
  }
}
