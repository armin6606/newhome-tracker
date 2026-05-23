/**
 * melia-map.ts
 *
 * Reads lot data from Melia Homes community pages.
 * Handles two distinct site plan systems:
 *
 *  ── System A: Zonda Virtual ─────────────────────────────────────────────
 *  Used by: Indigo, Elara (and likely future communities)
 *  How it works:
 *  1. Community page has an iframe with data-oi-defer-src pointing to
 *     https://apps.zondavirtual.com/alphamap/index.html?OLAId=<id>
 *  2. Fetch https://apps.zondavirtual.com/olajson/<OLAId>.json directly
 *  3. Read MasterSiteplan.LotDetails[] — each lot has LotNumber + status
 *  Status mapping: "Sold"→sold | "Available"/"Reserved"/"Model"→for sale |
 *                  "Not Released"/else→future
 *
 *  ── System B: Melia SP (sp.meliahomes.com) ──────────────────────────────
 *  Used by: Cerise, Towns at Orange (and likely future communities)
 *  How it works:
 *  1. Community page has an iframe with data-oi-defer-src pointing to
 *     https://sp.meliahomes.com/site-plans/<slug>/
 *  2. Navigate to that URL in Playwright, read window.siteplanArray
 *  3. Each entry has { residence, statusSlug, ... }
 *  Status mapping: "closed"/"sold"→sold | "available"/"model"/"reserved"→for sale |
 *                  else→future
 */

import { chromium, type BrowserContext } from "playwright"
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

    // ── Step 1: Extract iframe data-oi-defer-src ──────────────────────────
    // Both Zonda Virtual and Melia SP use data-oi-defer-src (lazy-loaded)
    const deferSrc = await page.evaluate(`
      (function() {
        var iframes = document.querySelectorAll("iframe[data-oi-defer-src]")
        for (var i = 0; i < iframes.length; i++) {
          var src = iframes[i].getAttribute("data-oi-defer-src") || ""
          if (src.indexOf("zondavirtual") !== -1 || src.indexOf("OLAId") !== -1) return src
          if (src.indexOf("sp.meliahomes.com") !== -1) return src
        }
        return null
      })()
    `) as string | null

    if (!deferSrc) {
      console.log(`[Melia] ${communityName}: No site plan iframe found (tried Zonda Virtual + Melia SP)`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    console.log(`[Melia] ${communityName}: iframe src=${deferSrc}`)

    // ── System A: Zonda Virtual ───────────────────────────────────────────
    if (deferSrc.indexOf("zondavirtual") !== -1 || deferSrc.indexOf("OLAId") !== -1) {
      return await readZondaVirtual(deferSrc, communityName)
    }

    // ── System B: Melia SP (sp.meliahomes.com) ────────────────────────────
    if (deferSrc.indexOf("sp.meliahomes.com") !== -1) {
      return await readMeliaSP(deferSrc, communityName, context)
    }

    console.log(`[Melia] ${communityName}: Unrecognised site plan URL: ${deferSrc}`)
    return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }

  } finally {
    await browser.close()
  }
}

// ── Zonda Virtual handler ─────────────────────────────────────────────────
async function readZondaVirtual(
  deferSrc: string,
  communityName: string
): Promise<MapResult> {
  const olaMatch = deferSrc.match(/OLAId=([a-f0-9-]+)/i)
  if (!olaMatch) {
    console.log(`[Melia] ${communityName}: Could not parse OLAId from: ${deferSrc}`)
    return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
  }

  const olaId = olaMatch[1]
  console.log(`[Melia] ${communityName}: Zonda OLAId=${olaId}`)

  const apiUrl = `https://apps.zondavirtual.com/olajson/${olaId}.json`
  const response = await fetch(apiUrl)
  if (!response.ok) {
    console.log(`[Melia] ${communityName}: Zonda JSON API returned ${response.status}`)
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
    console.log(`[Melia] ${communityName}: No LotDetails in Zonda JSON`)
    return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
  }

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

  return summarise(lots, communityName)
}

// ── Melia SP handler (sp.meliahomes.com) ──────────────────────────────────
async function readMeliaSP(
  spUrl: string,
  communityName: string,
  context: BrowserContext
): Promise<MapResult> {
  console.log(`[Melia] ${communityName}: Melia SP url=${spUrl}`)

  const spPage = await context.newPage()
  try {
    await spPage.goto(spUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    // Wait for siteplanArray to be populated (it's defined inline in the HTML)
    await spPage.waitForFunction("Array.isArray(window.siteplanArray) && window.siteplanArray.length > 0", {
      timeout: 15000,
    }).catch(() => null)

    const rawArray = await spPage.evaluate(`
      (function() {
        var arr = window.siteplanArray
        if (!Array.isArray(arr)) return null
        return JSON.stringify(arr)
      })()
    `) as string | null

    if (!rawArray) {
      console.log(`[Melia] ${communityName}: siteplanArray not found on Melia SP page`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: false }
    }

    const spArray = JSON.parse(rawArray) as Array<{
      residence?: string
      statusSlug?: string
      status?: string
      address?: string
    }>

    const lots: MapLot[] = spArray.map((unit, i) => {
      const s = (unit.statusSlug || unit.status || "").toLowerCase()
      let status: "for sale" | "sold" | "future"
      if (s === "closed" || s === "sold") {
        status = "sold"
      } else if (s === "available" || s === "model" || s === "reserved") {
        status = "for sale"
      } else {
        status = "future"
      }
      return {
        lotNumber: unit.residence ?? `unit-${i + 1}`,
        status,
        address: unit.address || undefined,
      }
    })

    return summarise(lots, communityName)
  } finally {
    await spPage.close()
  }
}

// ── Shared summary helper ─────────────────────────────────────────────────
function summarise(lots: MapLot[], communityName: string): MapResult {
  const sold    = lots.filter(l => l.status === "sold").length
  const forSale = lots.filter(l => l.status === "for sale").length
  const future  = lots.filter(l => l.status === "future").length
  const total   = lots.length
  console.log(`[Melia] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`)
  return { sold, forSale, future, total, lots }
}
