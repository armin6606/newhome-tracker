/**
 * kb-home-map.ts
 *
 * KB Home uses a third-party site plan platform: kb-vu.com (centravu®).
 * Each community page has an iframe whose data-src points to a kb-vu.com URL.
 *
 * This reader:
 *   1. Loads the KB Home community page and extracts the kb-vu.com iframe URL.
 *      At the same time, intercepts the Firebase payload.json (triggered by clicking
 *      the Homesites tab) to get per-lot floor plan specs (name, sqft, beds, baths,
 *      floors, garages).
 *   2. Navigates Playwright to the kb-vu.com URL.
 *   3. Reads individual lot data from the rendered DOM:
 *      - Teal   rgb(145,223,222) = Move-in ready  → for sale (has price + address)
 *      - Green  rgb(167,200,57)  = Pre-planned    → for sale (has price + address)
 *      - Orange rgb(241,93,34)   = Sold           → sold
 *      - Yellow rgb(255,193,7)   = Model home     → future (no price until released)
 *   4. Enriches each lot with floor plan data from the Firebase payload (matched
 *      by lot number or normalized address).
 *   5. Status rule: price + real address = "for sale", else = "future"
 *   6. Returns a MapResult with real lot-by-lot data (no placeholders needed)
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

const TEAL   = "rgb(145, 223, 222)"  // Move-in ready → for sale
const GREEN  = "rgb(167, 200, 57)"   // Pre-planned   → for sale
const ORANGE = "rgb(241, 93, 34)"    // Sold
const YELLOW = "rgb(255, 193, 7)"    // Model home    → future (no price)

interface FloorPlanData {
  floorPlan?: string
  sqft?: number
  beds?: number
  baths?: number
  floors?: number
  garages?: number
}

function normalizeAddr(addr: string): string {
  return addr.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Parse the Firebase siteplan payload into lookup maps keyed by lot number and address */
function buildFloorplanMaps(payload: Record<string, unknown>): {
  byLot: Map<string, FloorPlanData>
  byAddr: Map<string, FloorPlanData>
  payloadLots: Map<string, MapLot>
} {
  const byLot       = new Map<string, FloorPlanData>()
  const byAddr      = new Map<string, FloorPlanData>()
  const payloadLots = new Map<string, MapLot>()

  const floorplansArr = (payload.floorplans as Array<{ uid: string; name?: string; specs?: Record<string, unknown> }>) ?? []
  const fpMap: Record<string, { name?: string; specs?: Record<string, unknown> }> = {}
  for (const fp of floorplansArr) {
    if (fp.uid) fpMap[fp.uid] = fp
  }

  const site = payload.site as { segments?: Array<Record<string, unknown>> } | undefined
  for (const seg of site?.segments ?? []) {
    const fpUids = seg.floorplans as string[] | undefined
    const fpUid  = fpUids?.[0]
    const fp     = fpUid ? fpMap[fpUid] : undefined
    if (!fp) continue

    const specs   = (fp.specs ?? {}) as Record<string, unknown>
    const halfBath = specs.halfBath ? parseFloat(String(specs.halfBath)) * 0.5 : 0
    const data: FloorPlanData = {
      floorPlan: fp.name || undefined,
      sqft:     specs.sqft    ? parseInt(String(specs.sqft).replace(/[^0-9]/g, ""), 10) : undefined,
      beds:     specs.bed     ? parseFloat(String(specs.bed))     : undefined,
      baths:    specs.bath != null ? parseFloat(String(specs.bath)) + halfBath : undefined,
      floors:   specs.level   ? parseInt(String(specs.level), 10)  : undefined,
      garages:  specs.garage  ? parseInt(String(specs.garage), 10) : undefined,
    }

    // Index by lot number (e.g. "Homesite 9" → "9")
    const lotName = seg.lotName as string | undefined
    const lotNum  = lotName ? (lotName.match(/\d+/) ?? [])[0] : undefined
    if (lotNum) byLot.set(lotNum, data)

    // Index by normalized address
    const rawAddr = ((seg.address as string) || (seg.shortAddress as string) || "").replace(/,.*$/, "").trim()
    if (rawAddr) byAddr.set(normalizeAddr(rawAddr), data)

    if (lotNum) {
      payloadLots.set(lotNum, {
        lotNumber: lotNum,
        status: "future",
        address: rawAddr || undefined,
        floorPlan: data.floorPlan,
        sqft: data.sqft,
        beds: data.beds,
        baths: data.baths,
        floors: data.floors,
        garages: data.garages,
      })
    }
  }

  return { byLot, byAddr, payloadLots }
}

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

  // Intercept Firebase payload.json while the community page loads
  // (triggered when the Homesites tab is clicked)
  let firebasePayload: Record<string, unknown> | null = null
  page.on("response", async (res) => {
    try {
      if (
        res.url().includes("firebasestorage.googleapis.com") &&
        res.url().includes("payload.json") &&
        res.status() === 200
      ) {
        firebasePayload = await res.json()
      }
    } catch { /* ignore parse errors */ }
  })

  try {
    // ── Step 1: load KB Home community page ─────────────────────────────────
    console.log(`[KBHome] Loading community page: ${communityUrl}`)
    await page.goto(communityUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(1500, 2500))

    // Click the Homesites tab to trigger Firebase siteplan payload load
    await page.evaluate(() => {
      const el = document.querySelector('a[data-section="homesite-options"]') as HTMLElement | null
      if (el) el.click()
    })
    // Give Firebase time to respond (up to 5 s)
    await page.waitForTimeout(5000)

    const vuUrl = await page.evaluate(() => {
      const iframe = document.querySelector("iframe.interactiveFP") as HTMLIFrameElement | null
      return iframe?.getAttribute("data-src") || null
    })

    if (!vuUrl) {
      console.warn(`[KBHome] ${communityName}: No kb-vu.com iframe found on community page`)
      return { sold: 0, forSale: 0, future: 0, total: 0, lots: [] }
    }

    // Build floor plan lookup maps from Firebase payload (may be null if tab didn't load)
    const { byLot: fpByLot, byAddr: fpByAddr, payloadLots } = firebasePayload
      ? buildFloorplanMaps(firebasePayload)
      : { byLot: new Map<string, FloorPlanData>(), byAddr: new Map<string, FloorPlanData>(), payloadLots: new Map<string, MapLot>() }

    if (firebasePayload) {
      console.log(`[KBHome] ${communityName}: Firebase payload captured — ${fpByLot.size} lots with floor plan data`)
    } else {
      console.warn(`[KBHome] ${communityName}: Firebase payload not captured — floor plan data will be missing`)
    }

    // Clean the URL (strip trailing query params like ?nseFloorplanId=)
    const cleanVuUrl = vuUrl.split("?")[0]
    console.log(`[KBHome] ${communityName}: Loading site plan: ${cleanVuUrl}`)

    // ── Step 2: load the kb-vu.com site plan ────────────────────────────────
    await page.goto(cleanVuUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 3500))

    // Wait for homesite circles to appear
    await page.waitForFunction(
      () => document.querySelectorAll("span, div").length > 50,
      { timeout: 15000 }
    ).catch(() => console.warn(`[KBHome] ${communityName}: Timeout waiting for circles`))

    await page.waitForTimeout(randomDelayMs(1000, 2000))

    // ── Step 3: extract all lot data from kb-vu.com ──────────────────────────
    const rawLots: Array<{ lotNumber: string; status: "for sale" | "sold" | "future"; address?: string; price?: number }> =
      await page.evaluate(
        ({ TEAL, GREEN, ORANGE, YELLOW }) => {
          const seen = new Set<string>()
          const results: Array<{ lotNumber: string; status: "for sale" | "sold" | "future"; address?: string; price?: number }> = []

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
            const status: "for sale" | "sold" | "future" =
              bg === ORANGE ? "sold" :
              bg === YELLOW ? "future" :
              "for sale"

            // Walk up the DOM to find the card containing address + price
            let parent: Element | null = el.parentElement
            let cardText = ""
            for (let i = 0; i < 8; i++) {
              if (!parent) break
              const t = parent.textContent?.trim() || ""
              if (t.includes(`Homesite ${lotNum}`) && t.length < 300) {
                cardText = t.replace(/\s+/g, " ")
                break
              }
              parent = parent.parentElement
            }

            let address: string | undefined
            let price: number | undefined

            if (cardText) {
              // Pattern: "Homesite {lot}{streetNumber} {street...}${price}Home price"
              // Some Irvine streets are 3 digits (for example "309 Pluto").
              const m = cardText.match(new RegExp(`Homesite\\s+${lotNum}\\s*(\\d{3,5}[^$]+?)(?:\\$([0-9,]+))?(?:Home price|$)`))
              if (m) {
                address = m[1].trim()
                if (m[2]) {
                  const parsedPrice = parseInt(m[2].replace(/,/g, ""), 10)
                  // Reject placeholder prices (KB Home occasionally posts $10 or $1 for pending homes)
                  price = parsedPrice >= 10_000 ? parsedPrice : undefined
                }
              }
            }

            results.push({ lotNumber: lotNum, status, address, price: status === "for sale" ? price : undefined })
          }

          return results
        },
        { TEAL, GREEN, ORANGE, YELLOW }
      )

    // ── Step 4: enrich with floor plan data from Firebase ────────────────────
    const lots: MapLot[] = rawLots.map(raw => {
      const payloadLot = payloadLots.get(raw.lotNumber)
      const address = raw.address ?? payloadLot?.address
      const fp =
        fpByLot.get(raw.lotNumber) ??
        (address ? fpByAddr.get(normalizeAddr(address)) : undefined)

      return {
        lotNumber: raw.lotNumber,
        status:    raw.status,
        address,
        price:     raw.price,
        floorPlan: fp?.floorPlan,
        sqft:      fp?.sqft,
        beds:      fp?.beds,
        baths:     fp?.baths,
        floors:    fp?.floors,
        garages:   fp?.garages,
      } satisfies MapLot
    })

    const renderedLotNumbers = new Set(lots.map(l => l.lotNumber))
    for (const [lotNumber, payloadLot] of payloadLots.entries()) {
      if (!renderedLotNumbers.has(lotNumber)) lots.push(payloadLot)
    }

    const active = lots.filter(l => l.status === "for sale")
    const sold   = lots.filter(l => l.status === "sold")
    const future = lots.filter(l => l.status === "future")
    const withFP = lots.filter(l => l.floorPlan).length

    console.log(
      `[KBHome] ${communityName}: total=${lots.length} active=${active.length} sold=${sold.length} with-floorplan=${withFP}`
    )

    return {
      sold:    sold.length,
      forSale: active.length,
      future:  future.length,
      total:   lots.length,
      lots,
    }
  } finally {
    await browser.close()
  }
}
