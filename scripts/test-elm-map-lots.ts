/**
 * TEST ONLY — interacts with Toll Brothers map UI:
 * 1. Filter to Elm community
 * 2. Toggle Show Status OFF → extract all lot numbers
 * 3. Toggle Show Status ON → extract statuses per lot
 */
import { chromium } from "playwright"
import { randomUserAgent } from "../lib/scraper/utils"

const ELM_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: randomUserAgent(), viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  try {
    console.log("Loading page...")
    await page.goto(ELM_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)

    // Scroll to site plan
    await page.evaluate(() => {
      const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
      if (el) el.scrollIntoView()
    })
    await page.waitForTimeout(1500)

    // ── 1. Read the site plan selector options ─────────────────────────────
    console.log("\n=== Site Plan Selector Options ===")
    const selectorOptions = await page.evaluate(() => {
      const sel = document.querySelector('[class*="CommunitySitePlan_selector"]') as HTMLSelectElement
      if (!sel) return []
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.text.trim() }))
    })
    console.log(selectorOptions)

    // ── 2. Read SVG lot structure (sample) ────────────────────────────────
    console.log("\n=== SVG Lot Structure (first 10 g elements with IDs) ===")
    const svgLots = await page.evaluate(() => {
      const svg = document.querySelectorAll('svg')[2]
      if (!svg) return []
      const groups = Array.from(svg.querySelectorAll('g[id]'))
      return groups.slice(0, 20).map(g => ({
        id: g.id,
        className: g.className.baseVal,
        dataset: JSON.stringify((g as HTMLElement).dataset),
        childCount: g.children.length,
        innerText: (g as HTMLElement).innerText?.trim().substring(0, 50),
        fill: (g as SVGElement).getAttribute('fill'),
        style: (g as HTMLElement).style?.fill || (g as HTMLElement).getAttribute('style'),
      }))
    })
    for (const l of svgLots) {
      console.log(` id="${l.id}" class="${l.className}" dataset=${l.dataset} text="${l.innerText}" fill="${l.fill}"`)
    }

    // ── 3. Read lot number elements ───────────────────────────────────────
    console.log("\n=== Lot Number Elements (first 20) ===")
    const lotNumbers = await page.evaluate(() => {
      // Find elements with lot numbers
      const results: Array<{text: string; className: string; parentId: string}> = []

      // Check various selectors
      const selectors = [
        '[class*="lotNumber" i]', '[class*="lot-number" i]', '[class*="homesiteNumber" i]',
        '[class*="LotNumber" i]', '[class*="lotNum" i]',
      ]
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          results.push({
            text: (el as HTMLElement).innerText?.trim() || '',
            className: el.className || '',
            parentId: (el.closest('[id]') as HTMLElement)?.id || '',
          })
        })
        if (results.length > 0) break
      }

      // Also look for text elements in SVG near lot numbers
      if (results.length === 0) {
        document.querySelectorAll('text, tspan').forEach(el => {
          const text = el.textContent?.trim() || ''
          if (/^\d+$/.test(text) && parseInt(text) < 200) { // lot numbers are usually < 200
            const parent = el.closest('g') as Element
            results.push({
              text,
              className: el.className?.baseVal || el.className as unknown as string || '',
              parentId: parent?.id || '',
            })
          }
        })
      }
      return results.slice(0, 20)
    })
    for (const l of lotNumbers) console.log(` lot="${l.text}" class="${l.className}" parentId="${l.parentId}"`)

    // ── 4. Read current lot statuses from SVG ────────────────────────────
    console.log("\n=== Current lot status colors in SVG ===")
    const lotStatuses = await page.evaluate(() => {
      const svg = document.querySelectorAll('svg')[2]
      if (!svg) return { colorMap: {}, total: 0 }

      // Look for filled polygons/paths/rects that represent lots
      const shapes = svg.querySelectorAll('polygon, path, rect, circle')
      const colorMap: Record<string, number> = {}
      let total = 0

      shapes.forEach(s => {
        const fill = (s as SVGElement).getAttribute('fill') ||
                     window.getComputedStyle(s).fill || ''
        if (fill && fill !== 'none' && fill !== '' && fill !== 'transparent') {
          colorMap[fill] = (colorMap[fill] || 0) + 1
          total++
        }
      })

      return { colorMap, total }
    })
    console.log("Total colored shapes:", lotStatuses.total)
    console.log("Color distribution:", lotStatuses.colorMap)

    // ── 5. Check the SVG status element class more carefully ──────────────
    console.log("\n=== SVG status element ===")
    const statusEl = await page.evaluate(() => {
      const el = document.querySelector('[class*="SiteMapSVG_status"]') ||
                 document.querySelector('[class*="sitePlanHolder"]')
      if (!el) return "Not found"
      return {
        className: el.className,
        childCount: el.children.length,
        innerHTML: el.innerHTML.substring(0, 500),
      }
    })
    console.log(statusEl)

    // ── 6. Click "Show Status" OFF and read lot numbers ──────────────────
    console.log("\n=== Clicking Show Status OFF ===")
    const showStatusBtn = page.locator('button:has-text("Show Status")')
    const isVisible = await showStatusBtn.isVisible({ timeout: 3000 }).catch(() => false)

    if (isVisible) {
      console.log("Show Status button found, clicking...")
      await showStatusBtn.click()
      await page.waitForTimeout(1500)

      // Now read all lot numbers visible
      const allLots = await page.evaluate(() => {
        const results: string[] = []

        // Try SVG text elements
        document.querySelectorAll('svg text, svg tspan').forEach(el => {
          const text = el.textContent?.trim() || ''
          if (/^\d+$/.test(text)) results.push(text)
        })

        // Try DOM lot number elements
        const domSelectors = ['[class*="lotNumber" i]', '[class*="lot-number" i]', '[class*="LotNumber" i]']
        for (const sel of domSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            const text = (el as HTMLElement).innerText?.trim() || ''
            if (text) results.push(text)
          })
        }

        return [...new Set(results)].sort((a, b) => parseInt(a) - parseInt(b))
      })

      console.log(`Total lots visible with Status OFF: ${allLots.length}`)
      console.log("Lot numbers:", allLots.join(", "))

      // Screenshot with status off
      await page.screenshot({ path: '/c/Users/7316/Downloads/elm-status-off.png' })
      console.log("Screenshot saved: elm-status-off.png")

      // ── 7. Read statuses from SVG groups (status OFF = all lots shown) ──
      console.log("\n=== SVG groups when Status is OFF ===")
      const svgGroupsOff = await page.evaluate(() => {
        const svg = document.querySelectorAll('svg')[2]
        if (!svg) return []
        // Look for groups that changed (lot groups usually have class/data indicating status)
        const groups = Array.from(svg.querySelectorAll('g[id]'))
        return groups
          .filter(g => {
            const h = g as HTMLElement
            const text = h.innerText?.trim()
            // Only groups with lot number text
            return text && /^\d+$/.test(text.split('\n')[0])
          })
          .slice(0, 20)
          .map(g => ({
            id: g.id,
            className: g.className.baseVal,
            dataset: JSON.stringify((g as HTMLElement).dataset).substring(0, 200),
            text: (g as HTMLElement).innerText?.trim(),
            fill: (g as SVGElement).getAttribute('fill'),
          }))
      })
      for (const g of svgGroupsOff.slice(0, 10)) {
        console.log(` id="${g.id}" class="${g.className}" text="${g.text}" dataset=${g.dataset}`)
      }

      // ── 8. Click Show Status back ON ───────────────────────────────────
      console.log("\n=== Clicking Show Status back ON ===")
      await showStatusBtn.click()
      await page.waitForTimeout(1500)

      // Read lot statuses
      const lotStatusMap = await page.evaluate(() => {
        const svg = document.querySelectorAll('svg')[2]
        if (!svg) return {}

        const statusMap: Record<string, string> = {}

        // Look for groups with both a number and a fill color
        const groups = Array.from(svg.querySelectorAll('g[id]'))
        groups.forEach(g => {
          const text = (g as HTMLElement).innerText?.trim()
          if (!text || !/^\d+$/.test(text.split('\n')[0])) return

          const lotNum = text.split('\n')[0]
          // Find fill color of the main lot shape
          const shape = g.querySelector('polygon, path, rect')
          const fill = shape ? ((shape as SVGElement).getAttribute('fill') || window.getComputedStyle(shape).fill) : ''
          statusMap[lotNum] = fill
        })

        return statusMap
      })
      console.log(`\nLot→Color map (first 20):`, Object.entries(lotStatusMap).slice(0, 20))
      await page.screenshot({ path: '/c/Users/7316/Downloads/elm-status-on.png' })

    } else {
      console.log("Show Status button not found or not visible")
    }

  } finally {
    await browser.close()
  }
}

main().catch(console.error)
