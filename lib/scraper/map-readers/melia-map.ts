/**
 * melia-map.ts
 *
 * Reads lot data from the Melia Homes / Zonda Virtual interactive site plan.
 *
 * How it works:
 *  1. Load the Melia community page with Playwright
 *  2. Extract the OLAId from the iframe's data-oi-defer-src attribute
 *     e.g. https://apps.zondavirtual.com/alphamap/index.html?OLAId=<id>
 *  3. Fetch https://apps.zondavirtual.com/olajson/<OLAId>.json directly
 *  4. Read MasterSiteplan.LotDetails[] — each lot has LotNumber + status
 *
 * Status mapping:
 *  "Sold"                       → sold
 *  "Available" / "Reserved" /
 *  "Model"                      → for sale
 *  "Not Released" / anything else → future
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
    console.log(`[Melia] Loading page: ${url}`)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(1500, 3000))

    // ── Step 1: Extract OLAId from the Zonda Virtual iframe ──────────────────
    // The iframe is lazy-loaded via data-oi-defer-src, never set as src
    const deferSrc = await page.evaluate(`
      (function() {
        var iframes = document.querySelectorAll("iframe[data-oi-defer-src]")
        for (var i = 0; i < iframes.length; i++) {
          var src = iframes[i].getAttribute("data-oi-defer-src") || ""
          if (src.indexOf("zondavirtual") !== -1 || src.indexOf("OLAId") !== -1) return src
        }
        return null
      })()
    `) as string | null

    if (!deferSrc) {
      console.log(`[Melia] ${communityName}: No Zonda Virtual iframe found`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    const olaMatch = deferSrc.match(/OLAId=([a-f0-9-]+)/i)
    if (!olaMatch) {
      console.log(`[Melia] ${communityName}: Could not parse OLAId from: ${deferSrc}`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    const olaId = olaMatch[1]
    console.log(`[Melia] ${communityName}: OLAId=${olaId}`)

    // ── Step 2: Fetch the JSON data directly ─────────────────────────────────
    const apiUrl = `https://apps.zondavirtual.com/olajson/${olaId}.json`
    const response = await fetch(apiUrl)
    if (!response.ok) {
      console.log(`[Melia] ${communityName}: JSON API returned ${response.status}`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    const data = await response.json() as {
      MasterSiteplan?: {
        LotDetails?: Array<{
          LotId?: number
          LotNumber?: string
          status?: string
          Address?: string
        }>
      }
    }

    const lotDetails = data?.MasterSiteplan?.LotDetails
    if (!lotDetails || lotDetails.length === 0) {
      console.log(`[Melia] ${communityName}: No LotDetails in JSON response`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    // ── Step 3: Map lot statuses ──────────────────────────────────────────────
    const lots: MapLot[] = lotDetails.map((lot, i) => {
      const s = (lot.status || "").toLowerCase()
      let status: "for sale" | "sold" | "future"
      if (s === "sold") {
        status = "sold"
      } else if (s === "available" || s === "reserved" || s === "model") {
        status = "for sale"
      } else {
        status = "future"
      }
      return {
        lotNumber: lot.LotNumber ?? `lot-${i + 1}`,
        status,
        address: lot.Address || undefined,
      }
    })

    const sold    = lots.filter(l => l.status === "sold").length
    const forSale = lots.filter(l => l.status === "for sale").length
    const future  = lots.filter(l => l.status === "future").length
    const total   = lots.length

    console.log(`[Melia] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`)
    return { sold, forSale, future, total, lots }

  } finally {
    await browser.close()
  }
}
