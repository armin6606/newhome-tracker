/**
 * TEST ONLY — investigates the interactive map UI on Toll Brothers Elm Collection.
 * Goal: find filter dropdown, Show Status toggle, and lot elements.
 */
import { chromium } from "playwright"
import { randomUserAgent } from "../lib/scraper/utils"

const ELM_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: false }) // visible so we can see what's happening
  const context = await browser.newContext({ userAgent: randomUserAgent(), viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  try {
    console.log("Loading page...")
    await page.goto(ELM_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)

    // ── 1. Scroll down to find the site plan / map section ─────────────────
    console.log("\n=== Scrolling to find map/siteplan section ===")
    await page.evaluate(() => {
      const el = document.querySelector('[class*="siteplan" i], [class*="CommunitySitePlan" i], [id*="siteplan" i]')
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    })
    await page.waitForTimeout(2000)

    // ── 2. Find all buttons and interactive elements near the map ──────────
    const mapElements = await page.evaluate(() => {
      const results: string[] = []

      // Find siteplan container
      const container = document.querySelector('[class*="CommunitySitePlan"]') ||
                        document.querySelector('[class*="siteplan" i]') ||
                        document.querySelector('[id="siteplan"]')

      if (!container) {
        results.push("No siteplan container found")
        return results
      }

      results.push(`Container: ${container.className}`)

      // Find all buttons inside
      container.querySelectorAll('button, [role="button"], [class*="toggle" i], [class*="switch" i], [class*="filter" i]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim() || ''
        const cls = el.className || ''
        results.push(`Button: "${text}" | class: ${cls.substring(0, 80)}`)
      })

      // Find all select/dropdown elements
      container.querySelectorAll('select, [class*="dropdown" i], [class*="select" i]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim().substring(0, 100) || ''
        results.push(`Select/Dropdown: "${text}" | class: ${el.className.substring(0, 80)}`)
      })

      // Find filter-related elements
      document.querySelectorAll('[class*="filter" i], [class*="Filter" i]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim().substring(0, 60) || ''
        results.push(`Filter element: "${text}" | class: ${el.className.substring(0, 80)}`)
      })

      // Find status-related elements
      document.querySelectorAll('[class*="status" i], [class*="Status" i]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim().substring(0, 60) || ''
        const cls = el.className || ''
        results.push(`Status element: "${text}" | class: ${cls.substring(0, 80)}`)
      })

      // Find toggle/checkbox elements
      document.querySelectorAll('[class*="toggle" i], [class*="Toggle" i], input[type="checkbox"]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim().substring(0, 60) || ''
        results.push(`Toggle: "${text}" | class: ${el.className.substring(0, 80)} | type: ${el.tagName}`)
      })

      return results
    })

    for (const r of mapElements) console.log(" ", r)

    // ── 3. Find lot elements with status labels ────────────────────────────
    console.log("\n=== Lot elements ===")
    const lots = await page.evaluate(() => {
      const results: string[] = []

      // Try SVG-based siteplan
      const svgs = document.querySelectorAll('svg')
      results.push(`SVG elements: ${svgs.length}`)
      svgs.forEach((svg, i) => {
        const groups = svg.querySelectorAll('g[id], g[data-id], g[class*="lot" i], g[class*="homesite" i]')
        if (groups.length > 0) {
          results.push(`SVG[${i}] groups with id/lot: ${groups.length}`)
          // Show first few
          Array.from(groups).slice(0, 3).forEach(g => {
            results.push(`  g id="${g.id}" class="${g.className.baseVal}" data=${JSON.stringify(g.dataset).substring(0,100)}`)
          })
        }
      })

      // Try iframe-based map
      const iframes = document.querySelectorAll('iframe')
      results.push(`IFrames: ${iframes.length}`)
      iframes.forEach((f, i) => {
        results.push(`  iframe[${i}]: src=${f.src.substring(0, 100)}`)
      })

      // Try canvas
      const canvases = document.querySelectorAll('canvas')
      results.push(`Canvas elements: ${canvases.length}`)

      // Look for lot number elements
      const lotNums = document.querySelectorAll('[class*="lotNumber" i], [class*="lot-number" i], [class*="homesiteNumber" i]')
      results.push(`Lot number elements: ${lotNums.length}`)

      return results
    })
    for (const r of lots) console.log(" ", r)

    // ── 4. Take screenshot for visual inspection ───────────────────────────
    await page.screenshot({ path: '/c/Users/7316/Downloads/elm-map-screenshot.png', fullPage: false })
    console.log("\nScreenshot saved to /c/Users/7316/Downloads/elm-map-screenshot.png")

    // ── 5. Scroll to siteplan and screenshot just that area ────────────────
    const sitePlanBox = await page.evaluate(() => {
      const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
      if (!el) return null
      el.scrollIntoView()
      const rect = el.getBoundingClientRect()
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    })
    if (sitePlanBox) {
      console.log("\nSite plan section found at:", sitePlanBox)
      await page.waitForTimeout(1000)
      await page.screenshot({ path: '/c/Users/7316/Downloads/elm-siteplan.png' })
      console.log("Siteplan screenshot saved")
    }

    await page.waitForTimeout(3000) // pause to observe

  } finally {
    await browser.close()
  }
}

main().catch(console.error)
