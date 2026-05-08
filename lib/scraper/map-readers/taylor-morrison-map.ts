/**
 * taylor-morrison-map.ts
 *
 * Playwright-based map reader for Taylor Morrison interactive site plan.
 * Navigates to the community page, intercepts homesite API responses,
 * and falls back to DOM extraction if API interception yields nothing.
 *
 * KEY FIX (2026-05-08): Response listener must be registered BEFORE goto()
 * so it catches API calls fired during initial page load.
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

    // ── Register response listener BEFORE navigation ──────────────────────────
    // Must be set up before goto() — API calls fire during initial page load
    // and are missed if the listener is registered after networkidle.
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
        resUrl.includes("siteplan") ||
        resUrl.includes("site-plan") ||
        resUrl.includes("availab")
      ) {
        try {
          const ct = response.headers()["content-type"] || ""
          if (!ct.includes("json")) return
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
            : Array.isArray(json?.results)
            ? json.results
            : []
          if (arr.length > 0) {
            apiLots.push(...arr.filter((i: unknown) => typeof i === "object" && i !== null))
            apiIntercepted = true
            console.log(`[TaylorMorrison] ${communityName}: intercepted ${arr.length} lots from ${resUrl}`)
          }
        } catch {
          // ignore parse errors
        }
      }
    })

    // ── Navigate ──────────────────────────────────────────────────────────────
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    // ── Try to activate the site plan / homesites tab ─────────────────────────
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

    // ── Scroll to map to trigger lazy-loaded API calls ────────────────────────
    await page.evaluate(() => {
      const mapEl =
        document.querySelector('[class*="sitePlan"]') ||
        document.querySelector('[class*="siteplan"]') ||
        document.querySelector('[id*="siteplan"]') ||
        document.querySelector('[id*="site-plan"]') ||
        document.querySelector('[class*="SitePlan"]') ||
        document.querySelector('[class*="homesite"]') ||
        document.querySelector('[class*="Homesite"]')
      if (mapEl) mapEl.scrollIntoView()
      else window.scrollTo(0, document.body.scrollHeight / 2)
    })
    await page.waitForTimeout(randomDelayMs(3000, 5000))

    // ── Wait for any in-flight requests to settle after scroll ────────────────
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(randomDelayMs(1000, 2000))

    // ── Parse API results if intercepted ──────────────────────────────────────
    if (apiIntercepted && apiLots.length > 0) {
      console.log(`[TaylorMorrison] ${communityName}: API data — ${apiLots.length} lots`)

      const lots: MapLot[] = apiLots.map((lot, i) => {
        const lotNum = String(lot.number ?? lot.lotNumber ?? lot.id ?? `lot-${i + 1}`)
        const price =
          (typeof lot.price === "number" && lot.price > 0 ? lot.price : null) ??
          (typeof lot.listPrice === "number" && lot.listPrice > 0 ? lot.listPrice : null) ??
          undefined

        const s = (lot.status || "").toLowerCase()
        let status: "for sale" | "sold" | "future"
        if (s.includes("sold") || s.includes("closed") || s.includes("contract")) {
          status = "sold"
        } else if (s.includes("available") || s.includes("active")) {
          status = price ? "for sale" : "future"
        } else {
          status = "future"
        }

        return {
          lotNumber: lotNum,
          status,
          price: status === "for sale" ? price : undefined,
        } satisfies MapLot
      })

      const sold    = lots.filter((l) => l.status === "sold").length
      const forSale = lots.filter((l) => l.status === "for sale").length
      const future  = lots.filter((l) => l.status === "future").length
      const total   = lots.length
      console.log(`[TaylorMorrison] ${communityName}: total=${total} sold=${sold} forSale=${forSale} future=${future}`)
      return { sold, forSale, future, total, lots }
    }

    // ── Fallback: DOM-based per-lot extraction ────────────────────────────────
    console.log(`[TaylorMorrison] ${communityName}: No API data — falling back to DOM`)
    const domLots = await page.evaluate(() => {
      const processedIds = new Set<string>()
      const results: Array<{ lotNumber: string; status: string; price?: number }> = []

      const candidates = Array.from(
        document.querySelectorAll(
          // Current TM selectors (2026)
          "[class*='HomeCard'], [class*='homecard'], [class*='homesite'], " +
          "[class*='Homesite'], [class*='HomeSite'], " +
          "[class*='lot-card'], [class*='LotCard'], " +
          "[data-homesite], [data-lot], [data-lot-number], " +
          // SVG map selectors
          "svg [data-status], svg g[id*='lot'], svg g[id*='hs'], " +
          "svg g[class*='lot'], svg g[class*='homesite']"
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

        const numText =
          el.getAttribute("data-lot-number") ||
          el.getAttribute("data-homesite-number") ||
          el.getAttribute("data-lot") ||
          (el as HTMLElement).innerText?.match(/\d+/)?.[0] ||
          ""
        const numMatch = numText.match(/\d+/)
        if (!numMatch) continue
        const lotNumber = numMatch[0]

        const classStr = el.className?.toString().toLowerCase() || ""
        const dataStatus = (
          el.getAttribute("data-status") ||
          el.getAttribute("data-homesite-status") ||
          el.getAttribute("aria-label") ||
          ""
        ).toLowerCase()
        const combined = classStr + " " + dataStatus

        if (combined.includes("sold") || combined.includes("closed") || combined.includes("contract")) {
          results.push({ lotNumber, status: "sold" })
        } else if (combined.includes("available") || combined.includes("active")) {
          const priceText =
            el.getAttribute("data-price") ||
            el.querySelector("[class*='price'], [class*='Price']")?.textContent ||
            ""
          const priceNum = priceText ? parseInt(priceText.replace(/[^0-9]/g, ""), 10) : NaN
          const price = !isNaN(priceNum) && priceNum > 50000 ? priceNum : undefined
          results.push({ lotNumber, status: price ? "for sale" : "future", price })
        } else {
          results.push({ lotNumber, status: "future" })
        }
      }

      return results
    })

    const lots: MapLot[] = domLots.map((l) => ({
      lotNumber: l.lotNumber,
      status: l.status as "for sale" | "sold" | "future",
      price: l.price,
    }))

    const sold    = lots.filter((l) => l.status === "sold").length
    const forSale = lots.filter((l) => l.status === "for sale").length
    const future  = lots.filter((l) => l.status === "future").length
    const total   = lots.length

    console.log(`[TaylorMorrison] ${communityName}: DOM total=${total} sold=${sold} forSale=${forSale} future=${future}`)
    return { sold, forSale, future, total, lots }
  } finally {
    await browser.close()
  }
}
