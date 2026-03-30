/**
 * Read lot 44's fill color from the SVG and match it against the legend.
 */
import { chromium } from "playwright"

const URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })

  // Scroll to site plan to trigger SVG rendering
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(3000)

  // Wait for SVG iterated
  await page.waitForFunction(() => {
    const svgs = document.querySelectorAll('svg')
    for (const svg of Array.from(svgs)) {
      if (svg.getAttribute('iterated') === 'true') return true
    }
    return false
  }, { timeout: 15000 }).catch(() => console.log('iterated not found'))

  const data = await page.evaluate(() => {
    // ── 1. Find lot 44 polygon and get its fill color ──────────────────────
    const lotsGroups = Array.from(document.querySelectorAll('g[id]')).filter(g => /^LOTS-\d+$/.test(g.id))
    let lot44Color: string | null = null
    let lot44Computed: string | null = null
    let lot44Attrs: Record<string, string> = {}

    for (const group of lotsGroups) {
      for (const poly of Array.from(group.querySelectorAll('polygon'))) {
        const el = poly as HTMLElement & SVGElement
        if ((el as any).dataset?.lot_num === '44') {
          // SVG fill attribute
          lot44Color = el.getAttribute('fill') || el.getAttribute('style') || null
          // Computed style
          lot44Computed = window.getComputedStyle(el).fill || window.getComputedStyle(el).backgroundColor || null
          // All attributes
          for (const attr of Array.from(el.attributes)) {
            lot44Attrs[attr.name] = attr.value
          }
          // Also check parent g element classes/fill
          const parent = el.parentElement
          if (parent) {
            lot44Attrs['__parent_class'] = parent.className
            lot44Attrs['__parent_fill'] = parent.getAttribute('fill') || ''
            lot44Attrs['__parent_computed_fill'] = window.getComputedStyle(parent as any).fill || ''
          }
          break
        }
      }
    }

    // ── 2. Read the legend ─────────────────────────────────────────────────
    const legendItems: Array<{ label: string; color: string; computedColor: string }> = []

    // Try various legend selectors
    const legendSelectors = [
      '[class*="Legend"]', '[class*="legend"]',
      '[class*="SitePlan"] [class*="item"]',
      '[class*="sitePlan"] [class*="item"]',
    ]

    for (const sel of legendSelectors) {
      const els = document.querySelectorAll(sel)
      if (els.length > 0) {
        els.forEach(el => {
          const label = (el as HTMLElement).innerText?.trim()
          if (!label || label.length > 60) return

          // Look for a color swatch child
          const swatch = el.querySelector('[class*="color"], [class*="swatch"], [class*="dot"], [class*="box"], span, div') as HTMLElement | null
          const colorEl = swatch || (el as HTMLElement)
          const bg = window.getComputedStyle(colorEl).backgroundColor
          const fill = window.getComputedStyle(colorEl).fill
          const colorAttr = colorEl.getAttribute('fill') || colorEl.getAttribute('style') || ''

          legendItems.push({
            label,
            color: colorAttr,
            computedColor: bg !== 'rgba(0, 0, 0, 0)' ? bg : fill,
          })
        })
        if (legendItems.length > 0) break
      }
    }

    // ── 3. Also grab all colors used on all lot polygons with their plan names ──
    const planColorMap: Record<string, Set<string>> = {}
    for (const group of lotsGroups) {
      for (const poly of Array.from(group.querySelectorAll('polygon'))) {
        const el = poly as HTMLElement & SVGElement
        const planName = (el as any).dataset?.lot_name || 'unknown'
        const computedFill = window.getComputedStyle(el).fill || ''
        if (!planColorMap[planName]) planColorMap[planName] = new Set()
        planColorMap[planName].add(computedFill)
      }
    }
    // Convert sets to arrays
    const planColors: Record<string, string[]> = {}
    for (const [plan, colors] of Object.entries(planColorMap)) {
      planColors[plan] = Array.from(colors)
    }

    return { lot44Color, lot44Computed, lot44Attrs, legendItems, planColors }
  })

  console.log("\n=== Lot 44 ===")
  console.log("SVG fill attr:", data.lot44Color)
  console.log("Computed fill:", data.lot44Computed)
  console.log("All attrs:", JSON.stringify(data.lot44Attrs, null, 2))

  console.log("\n=== Legend Items ===")
  data.legendItems.forEach(item => {
    console.log(`  "${item.label}" → color: ${item.color} | computed: ${item.computedColor}`)
  })

  console.log("\n=== Plan → Colors (from all lot polygons) ===")
  for (const [plan, colors] of Object.entries(data.planColors)) {
    console.log(`  "${plan}": ${colors.join(', ')}`)
  }

  await browser.close()
}

main().catch(console.error)
