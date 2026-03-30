/**
 * TEST ONLY — investigates map data available on Toll Brothers Elm Collection page.
 */
import { chromium } from "playwright"
import { randomUserAgent } from "../lib/scraper/utils"

const ELM_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: randomUserAgent() })
  const page = await context.newPage()

  // ── Intercept all JSON API responses ──────────────────────────────────────
  const captured: Array<{ url: string; body: unknown }> = []
  page.on("response", async (res) => {
    const url = res.url()
    const ct = res.headers()["content-type"] || ""
    if (!ct.includes("json")) return
    try {
      const body = await res.json()
      captured.push({ url, body })
    } catch { /* ignore */ }
  })

  try {
    console.log("Loading Elm Collection page (waiting for network idle)...\n")
    await page.goto(ELM_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(3000)

    // ── 1. Show all captured JSON calls ───────────────────────────────────
    console.log(`=== Captured ${captured.length} JSON API responses ===`)
    for (const { url, body } of captured) {
      const json = JSON.stringify(body)
      // Only show ones that look homesite/lot related
      const relevant = /(homesite|lot|homesit|avail|status|sold|inventory|sitePlan|siteplan|plan|unit)/i.test(url + json)
      if (!relevant && json.length < 50) continue
      console.log(`\nURL: ${url}`)
      console.log(`Size: ${json.length} chars`)

      // If it has status fields, count them
      const statusMatches = json.match(/"status"\s*:\s*"([^"]+)"/g)
      if (statusMatches) {
        const counts: Record<string, number> = {}
        for (const m of statusMatches) {
          const s = m.match(/"status"\s*:\s*"([^"]+)"/)?.[1] || ""
          counts[s] = (counts[s] || 0) + 1
        }
        console.log("Status counts:", counts)
      }

      // Show first 300 chars of body
      console.log("Preview:", json.substring(0, 300))
    }

    // ── 2. Check __NEXT_DATA__ for homesites ──────────────────────────────
    const nextRaw = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__")
      return el ? el.textContent : null
    })

    if (nextRaw) {
      console.log("\n=== __NEXT_DATA__ found, size:", nextRaw.length, "chars ===")
      const nd = JSON.parse(nextRaw)
      const ndJson = JSON.stringify(nd)

      // Count status occurrences
      const statusMatches = ndJson.match(/"status"\s*:\s*"([^"]+)"/g) || []
      const counts: Record<string, number> = {}
      for (const m of statusMatches) {
        const s = m.match(/"status"\s*:\s*"([^"]+)"/)?.[1] || ""
        counts[s] = (counts[s] || 0) + 1
      }
      console.log("Status counts in __NEXT_DATA__:", counts)

      // Count lotId / homesiteId occurrences
      const lotIds = ndJson.match(/"(?:lotId|homesiteId|lot_id|homesite_id|lotNumber)"\s*:\s*"([^"]+)"/g) || []
      console.log("Lot/homesite ID fields found:", lotIds.length)

      // Look for arrays of objects with status
      function findHomesiteArrays(obj: unknown, path = ""): void {
        if (!obj || typeof obj !== "object") return
        if (Array.isArray(obj)) {
          if (obj.length > 0) {
            const first = obj[0] as Record<string, unknown>
            if (first && typeof first === "object" && ("status" in first || "lotId" in first || "homesiteId" in first || "lotNumber" in first)) {
              console.log(`\nFound homesite-like array at path: ${path} (${obj.length} items)`)
              console.log("First item:", JSON.stringify(first).substring(0, 300))
              const sc: Record<string, number> = {}
              for (const item of obj) {
                const s = String((item as Record<string, unknown>)?.status ?? "no-status")
                sc[s] = (sc[s] || 0) + 1
              }
              console.log("Status distribution:", sc)
            }
          }
          for (let i = 0; i < Math.min(obj.length, 3); i++) {
            findHomesiteArrays(obj[i], `${path}[${i}]`)
          }
        } else {
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            findHomesiteArrays(v, path ? `${path}.${k}` : k)
          }
        }
      }
      findHomesiteArrays(nd)
    } else {
      console.log("\n No __NEXT_DATA__ found")
    }

    // ── 3. Check window globals ───────────────────────────────────────────
    const windowKeys = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>
      const interestingKeys: string[] = []
      for (const k of Object.keys(win)) {
        if (/(homesite|lot|community|apollo|redux|state|store|data|inventory|sitePlan)/i.test(k)) {
          interestingKeys.push(k)
        }
      }
      return interestingKeys
    })
    if (windowKeys.length) {
      console.log("\n=== Interesting window globals:", windowKeys)
    }

    // ── 4. Check Apollo Client cache (if present) ─────────────────────────
    const apolloData = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>
      // Common Apollo client variable names
      for (const key of ["__APOLLO_STATE__", "__apollo_client__", "apolloClient"]) {
        if (win[key]) return { key, preview: JSON.stringify(win[key]).substring(0, 500) }
      }
      // Check for apollo client attached to Next.js data
      return null
    })
    if (apolloData) {
      console.log("\n=== Apollo state found:", apolloData.key)
      console.log(apolloData.preview)
    }

    // ── 5. Check for site plan / map elements in the DOM ─────────────────
    const mapInfo = await page.evaluate(() => {
      const results: string[] = []

      // Look for map/siteplan elements
      const selectors = [
        '[class*="siteplan" i]', '[class*="site-plan" i]', '[class*="interactiveMap" i]',
        '[class*="lotMap" i]', '[class*="mapContainer" i]', '[id*="siteplan" i]',
        '[data-lot]', '[data-homesite]', '[data-status]',
        'svg[class*="map"]', 'canvas[class*="map"]',
        '[class*="availabilityMap" i]', '[class*="homesiteMap" i]',
      ]

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) {
          const el = els[0] as HTMLElement
          results.push(`${sel}: ${els.length} found | class="${el.className}" | data=${JSON.stringify(el.dataset).substring(0, 100)}`)
        }
      }

      // Count lot-related data attributes
      const dataLots = document.querySelectorAll("[data-lot-id],[data-lot-number],[data-homesite-id],[data-status]")
      if (dataLots.length) results.push(`data-lot-* elements: ${dataLots.length}`)

      return results
    })
    console.log("\n=== DOM map/siteplan elements ===")
    if (mapInfo.length) {
      for (const r of mapInfo) console.log(" ", r)
    } else {
      console.log("  None found")
    }

    // ── 6. Dump all unique API URLs called ────────────────────────────────
    console.log("\n=== All API calls made ===")
    const allUrls = captured.map(c => c.url)
    for (const u of allUrls) {
      if (!u.includes("google") && !u.includes("analytics") && !u.includes("fonts")) {
        console.log(" ", u)
      }
    }

  } finally {
    await browser.close()
  }
}

main().catch(console.error)
