/**
 * Build a color→plan map from named lots, then identify "no data" lots.
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
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(3000)

  await page.waitForFunction(() => {
    const svgs = document.querySelectorAll('svg')
    for (const svg of Array.from(svgs)) {
      if (svg.getAttribute('iterated') === 'true') return true
    }
    return false
  }, { timeout: 15000 }).catch(() => {})

  const result = await page.evaluate(() => {
    const lotsGroups = Array.from(document.querySelectorAll('g[id]')).filter((g) =>
      /^LOTS-\d+$/.test(g.id)
    )

    // Step 1: build color → planName from lots that HAVE a plan name
    const colorToPlan: Record<string, string> = {}
    const allLots: Array<{ lotNum: string; status: string; planName: string; color: string }> = []

    for (const group of lotsGroups) {
      for (const poly of Array.from(group.querySelectorAll('polygon'))) {
        const el = poly as HTMLElement
        const lotNum = (el as any).dataset?.lot_num || ''
        const status = (el as any).dataset?.lot_status || ''
        const planName = (el as any).dataset?.lot_name || ''
        const color = (el as any).dataset?.lotColor || (el as any).getAttribute?.('data-lotColor') || ''

        allLots.push({ lotNum, status, planName, color })

        if (planName && planName !== 'no data' && color) {
          if (!colorToPlan[color]) colorToPlan[color] = planName
        }
      }
    }

    // Step 2: also read the SVG legend text elements (plan name labels in SVG)
    // Find <text> elements whose content matches a plan name, then find the nearest rect/path with a fill
    const svgLegendMap: Record<string, string> = {}
    const svgTexts = Array.from(document.querySelectorAll('svg text'))
    for (const textEl of svgTexts) {
      const txt = (textEl as SVGTextElement).textContent?.trim() || ''
      // Look for plan name labels (short, title-case names)
      if (txt.length > 2 && txt.length < 30 && /^[A-Z][a-z]/.test(txt)) {
        // Look for sibling or nearby rect/polygon with a fill
        const parent = textEl.parentElement
        if (!parent) continue
        const colorEl = parent.querySelector('rect, polygon, path') as SVGElement | null
        if (colorEl) {
          const fill = colorEl.getAttribute('fill') || window.getComputedStyle(colorEl).fill
          if (fill && fill !== 'none') {
            svgLegendMap[fill] = txt
          }
        }
      }
    }

    // Step 3: resolve "no data" lots using the color map
    const resolved = allLots.map(lot => ({
      ...lot,
      resolvedPlan: lot.planName !== 'no data' && lot.planName
        ? lot.planName
        : (colorToPlan[lot.color] || `unknown(${lot.color})`),
    }))

    return { colorToPlan, svgLegendMap, resolved }
  })

  console.log("=== Color → Plan (from named lots) ===")
  for (const [color, plan] of Object.entries(result.colorToPlan)) {
    console.log(`  ${color} → ${plan}`)
  }

  console.log("\n=== SVG legend map ===")
  for (const [color, plan] of Object.entries(result.svgLegendMap)) {
    console.log(`  ${color} → ${plan}`)
  }

  console.log("\n=== Previously 'no data' lots — resolved ===")
  result.resolved
    .filter(l => l.planName === 'no data' || !l.planName)
    .forEach(l => console.log(`  Lot ${l.lotNum.padEnd(4)} color=${l.color} → ${l.resolvedPlan}`))

  await browser.close()
}

main().catch(console.error)
