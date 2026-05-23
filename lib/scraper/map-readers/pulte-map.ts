/**
 * pulte-map.ts
 *
 * Playwright-based map reader for Pulte/Del Webb (AlphaVision iframe) interactive site plan.
 *
 * Strategy (tried in order):
 * 1. Navigate to community URL → find AlphaVision iframe
 * 2. Load iframe in new page, then:
 *    a. window.siteplanObjData.MasterSiteplan.LotDetails  ← primary (ZondaVirtual global)
 *    b. Intercepted JSON API responses containing lot arrays ← fallback
 *    c. DOM element counting by ID pattern              ← last resort
 *
 * Status mapping for siteplanObjData (ZondaVirtual/Del Webb):
 *   Quick Move In → active  (home is built and ready to buy)
 *   Available     → future  (lot to build on, no home yet)
 *   Sold / Closed → sold
 *   Unreleased / Model / anything else → future
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
): "for sale" | "sold" | "future" {
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
    return "for sale"
  }
  // Not released, pending, model, spec — treat as future
  return "future"
}

/**
 * Status mapping for window.siteplanObjData (ZondaVirtual/AlphaVision global).
 * "Quick Move In" = home already built and ready to purchase → active.
 * "Available"     = lot available to build on, no home yet → future.
 */
function normalizeSiteplanStatus(status: string): "for sale" | "sold" | "future" {
  const s = (status || "").toLowerCase().trim()
  if (s === "sold" || s === "closed" || s.includes("contract") || s.includes("reserved")) return "sold"
  if (s === "quick move in" || s === "qmi" || s === "move-in ready" || s === "moveinready") return "for sale"
  // Available, Unreleased, Model, Not Released, Pending, Spec → future
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
      waitUntil: "load",
      timeout: 60000,
    })
    await iframePage.waitForTimeout(randomDelayMs(2000, 4000))

    // ── Path A: window.siteplanObjData (ZondaVirtual global — most reliable) ──
    // This object is populated by AlphaVision's JS bundle at page load.
    // It contains full lot details in MasterSiteplan.LotDetails[].
    const siteplanData = await iframePage.evaluate(() => {
      const sp = (window as any).siteplanObjData
      if (!sp?.MasterSiteplan?.LotDetails?.length) return null

      return (sp.MasterSiteplan.LotDetails as any[]).map((lot) => {
        // Extract address from infoList key-value pairs
        const addressEntry = (lot.infoList as any[] | undefined)?.find(
          (i) => (i.Key || "").toLowerCase() === "address"
        )
        const address = addressEntry?.Value?.trim() || undefined

        return {
          lotNumber: String(lot.LotNumber ?? lot.lotNumber ?? ""),
          status: String(lot.status ?? ""),
          address,
        }
      })
    })

    if (siteplanData && siteplanData.length > 0) {
      console.log(`[Pulte] ${communityName}: siteplanObjData — ${siteplanData.length} lots`)

      const lots: MapLot[] = siteplanData
        .filter((l) => l.lotNumber)
        .map((l) => ({
          lotNumber: l.lotNumber,
          status: normalizeSiteplanStatus(l.status),
          address: l.address,
          // Price is not in LotDetails — QMI lots are marked active without price.
          // buildListings in index.ts will preserve "active" when a real address is present.
          price: undefined,
        } satisfies MapLot))

      const sold    = lots.filter((l) => l.status === "sold").length
      const forSale = lots.filter((l) => l.status === "for sale").length
      const future  = lots.filter((l) => l.status === "future").length

      console.log(`[Pulte] ${communityName}: sold=${sold} forSale=${forSale} future=${future} total=${lots.length}`)
      return { sold, forSale, future, total: lots.length, lots }
    }

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
          price: status === "for sale" ? price : undefined,
        } satisfies MapLot
      })

      const sold = lots.filter((l) => l.status === "sold").length
      const forSale = lots.filter((l) => l.status === "for sale").length
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
    // Use "load" instead of "networkidle" — Del Webb/Pulte pages have persistent
    // background requests (ads, analytics) that prevent networkidle from settling.
    await page.goto(url, { waitUntil: "load", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(3000, 5000))

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
      // ── QMI DOM fallback: communities without interactive site plan ──────────
      console.log(`[Pulte] ${communityName}: No AlphaVision iframe — trying QMI DOM scrape`)

      // Click "Quick Move-In" filter label if present
      try {
        const qmiLabel = page.locator("label").filter({ hasText: /Quick Move-In/i }).first()
        if (await qmiLabel.isVisible({ timeout: 3000 })) {
          await qmiLabel.click()
          await page.waitForTimeout(randomDelayMs(2000, 3000))
        }
      } catch { /* no QMI filter */ }

      // Scroll to trigger lazy-loading of home cards
      await page.evaluate(() => {
        const sec =
          document.querySelector('[class*="homes"]') ||
          document.querySelector('[id*="homes"]') ||
          document.querySelector('[class*="Plans"]')
        if (sec) sec.scrollIntoView()
        else window.scrollTo(0, Math.floor(document.body.scrollHeight / 3))
      })
      await page.waitForTimeout(randomDelayMs(2000, 3000))

      // Wait up to 8 s for any homesite card to appear
      try {
        await page.waitForFunction(
          () => /Homesite\s*#/i.test((document.body as HTMLElement).innerText || ""),
          { timeout: 8000 }
        )
      } catch { /* no homesite cards */ }

      const qmiLots = await page.evaluate(() => {
        const results: Array<{
          address: string
          lotNumber: string
          price?: number
          floorPlan?: string
          beds?: number
          baths?: number
          sqft?: number
          moveInDate?: string
        }> = []

        // Walk the text tree for "Homesite #" labels
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const homesiteNodes: Node[] = []
        let node: Node | null
        while ((node = walker.nextNode())) {
          if (/^\s*Homesite\s*#?\s*$/i.test(node.textContent || "")) {
            homesiteNodes.push(node)
          }
        }

        const seen = new Set<string>()
        for (const hsNode of homesiteNodes) {
          // Walk up to find the card container
          let card: Element | null = hsNode.parentElement
          for (let i = 0; i < 12; i++) {
            if (!card?.parentElement) break
            card = card.parentElement
            const ct = (card as HTMLElement).innerText || ""
            if (ct.includes("Priced at") && /\d{5}/.test(ct)) break
          }
          if (!card) continue

          const text = (card as HTMLElement).innerText || ""

          // Lot number appears immediately before "Homesite #"
          const lotMatch = text.match(/(\d{3,6})\s*\n\s*Homesite\s*#?/i)
          const lotNumber = lotMatch?.[1]
          if (!lotNumber || seen.has(lotNumber)) continue
          seen.add(lotNumber)

          // Street address (number + street, city, state zip)
          const addrMatch = text.match(
            /(\d+\s+[A-Za-z][A-Za-z\s]+,\s*[A-Za-z][A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5})/
          )
          const address = addrMatch?.[1]?.trim()
          if (!address) continue

          // Price ("$1,605,442 Priced at" or "$1,555,442\nWas $1,605,442")
          const priceMatch =
            text.match(/\$([\d,]+)\s*\n?\s*Was\s*\$/i) ??   // new: "$1,555,442\nWas $1,605,442"
            text.match(/\$([\d,]+)\s*\n?\s*Priced at/i)       // old: "$1,605,442 Priced at"
          const price = priceMatch
            ? parseInt(priceMatch[1].replace(/,/g, ""), 10)
            : undefined

          // Floor plan
          const planMatch = text.match(/^(Plan\s+\d+)/mi)
          const floorPlan = planMatch?.[1]?.trim()

          // Specs
          const sqftMatch = text.match(/([\d,]+)\s*\n?\s*Sq\.\s*Ft\./i)
          const bedsMatch = text.match(/(\d+)\s*\n?\s*Beds?\b/i)
          const bathsMatch = text.match(/([\d.]+)\s*\n?\s*Baths?\b/i)
          const moveInMatch = text.match(
            /([A-Za-z]+\s+\d{4})\s*\n?\s*Anticipated Completion/i
          )

          results.push({
            address,
            lotNumber,
            price,
            floorPlan,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, ""), 10) : undefined,
            beds: bedsMatch ? parseInt(bedsMatch[1], 10) : undefined,
            baths: bathsMatch ? parseFloat(bathsMatch[1]) : undefined,
            moveInDate: moveInMatch?.[1],
          })
        }
        return results
      })

      if (qmiLots.length > 0) {
        console.log(`[Pulte] ${communityName}: QMI DOM — ${qmiLots.length} homes`)
        const lots: MapLot[] = qmiLots.map((l) => ({
          lotNumber: l.lotNumber,
          status: "for sale" as const,
          price: l.price,
          address: l.address,
          floorPlan: l.floorPlan,
          beds: l.beds,
          baths: l.baths,
          sqft: l.sqft,
          moveInDate: l.moveInDate,
        }))
        console.log(`[Pulte] ${communityName}: forSale=${lots.length} total=${lots.length}`)
        return { sold: 0, forSale: lots.length, future: 0, total: lots.length, lots, qmiOnly: true }
      }

      console.log(`[Pulte] ${communityName}: No AlphaVision iframe and QMI scrape found nothing — skipping`)
      return { sold: 0, forSale: 0, future: 0, total: 0 }
    }

    return await readAlphaVisionIframe(page, iframeSrc, communityName)
  } finally {
    await browser.close()
  }
}
