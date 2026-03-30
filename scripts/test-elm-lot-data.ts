/**
 * TEST ONLY — reads per-lot status data from Toll Brothers SVG site plan.
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
    await page.goto(ELM_URL, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)

    // Scroll to site plan section
    await page.evaluate(() => {
      document.querySelector('[class*="CommunitySitePlan"]')?.scrollIntoView()
    })
    await page.waitForTimeout(1500)

    // ── 1. Read the LOTS-9167 group structure ──────────────────────────────
    console.log("=== Exploring LOTS-9167 group ===")
    const lotsGroup = await page.evaluate(() => {
      const lotsEl = document.getElementById('LOTS-9167')
      if (!lotsEl) return { found: false }

      // Direct children
      const children = Array.from(lotsEl.children)
      const childInfo = children.slice(0, 5).map(c => ({
        tag: c.tagName,
        id: c.id,
        className: c.className.toString().substring(0, 100),
        dataset: JSON.stringify((c as HTMLElement).dataset).substring(0, 200),
        childCount: c.children.length,
      }))

      // All text elements inside
      const texts = Array.from(lotsEl.querySelectorAll('text, tspan')).slice(0, 10).map(t => ({
        text: t.textContent?.trim(),
        parentId: t.parentElement?.id,
        parentClass: t.parentElement?.className.toString(),
      }))

      return { found: true, childCount: children.length, childInfo, texts }
    })
    console.log(JSON.stringify(lotsGroup, null, 2))

    // ── 2. Look at every g element in the SVG for lot-specific attributes ──
    console.log("\n=== SVG g elements with data-status or lot-related attributes ===")
    const lotData = await page.evaluate(() => {
      const svg = document.querySelectorAll('svg')[2]
      if (!svg) return []

      const results: Array<{
        id: string;
        className: string;
        dataset: Record<string, string>;
        computedFill: string;
        attrFill: string;
        lotNum: string;
        childTexts: string[];
      }> = []

      svg.querySelectorAll('g').forEach(g => {
        const ds = (g as HTMLElement).dataset
        // Look for groups with data attributes that suggest lot status
        const hasLotData = ds.status || ds.lotId || ds.lot || ds.homesite ||
                           ds.available || ds.sold || g.id.match(/^LOT|^HS|^\d+$/)
        if (!hasLotData) return

        const texts = Array.from(g.querySelectorAll('text, tspan'))
          .map(t => t.textContent?.trim() || '')
          .filter(t => t.length > 0)

        // Get computed fill of first colored child
        const colorEl = g.querySelector('[fill], polygon, path, rect') as SVGElement | null
        const computedFill = colorEl ? window.getComputedStyle(colorEl).fill : ''
        const attrFill = colorEl ? (colorEl.getAttribute('fill') || '') : ''

        results.push({
          id: g.id,
          className: g.className.baseVal.substring(0, 80),
          dataset: Object.fromEntries(Object.entries(ds)),
          computedFill: computedFill.substring(0, 50),
          attrFill: attrFill.substring(0, 50),
          lotNum: texts.find(t => /^\d+$/.test(t)) || '',
          childTexts: texts.slice(0, 3),
        })
      })
      return results.slice(0, 30)
    })
    for (const l of lotData) {
      console.log(` id="${l.id}" dataset=${JSON.stringify(l.dataset)} lot="${l.lotNum}" fill="${l.computedFill}" texts=${JSON.stringify(l.childTexts)}`)
    }

    // ── 3. Check CSS classes applied to lot elements when status is ON ─────
    console.log("\n=== CSS class analysis on lot elements ===")
    const cssAnalysis = await page.evaluate(() => {
      const svg = document.querySelectorAll('svg')[2]
      if (!svg) return []

      // Get all unique class combinations on g elements
      const classSets: Record<string, number> = {}
      svg.querySelectorAll('g').forEach(g => {
        const cls = g.className.baseVal.trim()
        if (cls) classSets[cls] = (classSets[cls] || 0) + 1
      })
      return Object.entries(classSets).sort((a, b) => b[1] - a[1]).slice(0, 20)
    })
    console.log("Top g element classes:")
    for (const [cls, count] of cssAnalysis) console.log(` ${count}x "${cls}"`)

    // ── 4. Look at status-colored elements specifically ────────────────────
    console.log("\n=== Status-colored elements (lot shapes) ===")
    const coloredLots = await page.evaluate(() => {
      // The status colors based on what we know:
      // rgb(163, 31, 52) = Sold (red)
      // rgb(0, 157, 71) = Available (green)
      // rgb(88, 58, 113) = QMI/Reserved (purple)
      const STATUS_COLORS: Record<string, string> = {
        'rgb(163, 31, 52)': 'sold',
        'rgb(0, 157, 71)': 'available',
        'rgb(88, 58, 113)': 'qmi_or_reserved',
      }

      const svg = document.querySelectorAll('svg')[2]
      if (!svg) return []

      const results: Array<{lot: string; color: string; status: string; parentId: string; parentClass: string}> = []

      svg.querySelectorAll('polygon, rect, path').forEach(shape => {
        const fill = window.getComputedStyle(shape).fill
        const status = STATUS_COLORS[fill]
        if (!status) return

        // Find the lot number near this shape (in parent g)
        const parentG = shape.closest('g')
        const texts = Array.from(parentG?.querySelectorAll('text, tspan') || [])
          .map(t => t.textContent?.trim() || '')
          .filter(t => /^\d+$/.test(t))

        results.push({
          lot: texts[0] || '?',
          color: fill,
          status,
          parentId: parentG?.id || '',
          parentClass: parentG?.className.baseVal.substring(0, 60) || '',
        })
      })
      return results
    })

    console.log(`Found ${coloredLots.length} status-colored shapes`)
    const byStatus: Record<string, number> = {}
    for (const l of coloredLots) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1
      console.log(` lot=${l.lot} status=${l.status} parentId=${l.parentId}`)
    }
    console.log("\nStatus totals:", byStatus)

    // ── 5. Try the Overall Site Plan + check filter options ────────────────
    console.log("\n=== Switching to Overall Site Plan ===")
    await page.selectOption('[class*="CommunitySitePlan_selector"]', '667489')
    await page.waitForTimeout(2000)

    // Find filter panel and look for community filter
    const filterPanelInfo = await page.evaluate(() => {
      // Check if filter panel is open
      const panel = document.querySelector('[class*="SitePlanPanel"]') ||
                    document.querySelector('[class*="filterPanel"]')
      if (!panel) return "No filter panel"

      // Find community filter options
      const communityFilters = Array.from(panel.querySelectorAll('[class*="community" i], [class*="Community" i]'))
        .map(el => (el as HTMLElement).innerText?.trim().substring(0, 100))

      return { panelClass: (panel as HTMLElement).className.substring(0, 80), communityFilters }
    })
    console.log("Filter panel:", filterPanelInfo)

    // On Overall plan, click Status OFF and count lots
    const showStatusBtn = page.locator('button:has-text("Show Status")')
    if (await showStatusBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await showStatusBtn.click()
      await page.waitForTimeout(1500)

      const overallLots = await page.evaluate(() => {
        const lotNums: string[] = []
        document.querySelectorAll('svg text, svg tspan').forEach(el => {
          const text = el.textContent?.trim() || ''
          if (/^\d+$/.test(text) && parseInt(text) <= 500) lotNums.push(text)
        })
        return [...new Set(lotNums)].sort((a, b) => parseInt(a) - parseInt(b))
      })
      console.log(`\nOverall plan lots visible: ${overallLots.length}`)
      console.log("Lot numbers:", overallLots.join(', '))
    }

  } finally {
    await browser.close()
  }
}

main().catch(console.error)
