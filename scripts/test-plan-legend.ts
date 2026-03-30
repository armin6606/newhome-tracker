/**
 * Find and read the plan color legend on the Elm Collection site plan map.
 */
import { chromium } from "playwright"

const URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: false }) // headed so we can see what triggers the legend
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

  // Search for the plan legend — try all elements containing plan names + color swatches
  const legendData = await page.evaluate(() => {
    const planNames = ["Aldrin", "Poppi", "Sorrel", "Vinca"]
    const results: Array<{ selector: string; text: string; html: string }> = []

    // Walk every element, looking for ones that contain multiple plan names
    document.querySelectorAll('*').forEach(el => {
      const txt = (el as HTMLElement).innerText || ''
      const matchCount = planNames.filter(p => txt.includes(p)).length
      if (matchCount >= 2 && txt.length < 500) {
        results.push({
          selector: el.className?.toString()?.slice(0, 80) || el.tagName,
          text: txt.trim().slice(0, 300),
          html: el.innerHTML?.slice(0, 500),
        })
      }
    })
    return results.slice(0, 10)
  })

  console.log(`Found ${legendData.length} elements with multiple plan names:`)
  legendData.forEach((item, i) => {
    console.log(`\n[${i+1}] class="${item.selector}"`)
    console.log('TEXT:', item.text)
    console.log('HTML:', item.html)
  })

  // Also dump all data-lotColor values grouped by data-lot_name
  const colorMap = await page.evaluate(() => {
    const map: Record<string, string[]> = {}
    document.querySelectorAll('[data-lot_name]').forEach(el => {
      const name = (el as HTMLElement).dataset?.lot_name || 'unknown'
      const color = (el as HTMLElement).dataset?.lot_color || (el as HTMLElement).getAttribute('data-lotColor') || ''
      if (!map[name]) map[name] = []
      if (color && !map[name].includes(color)) map[name].push(color)
    })
    return map
  })
  console.log('\n=== data-lotColor per plan name ===')
  for (const [plan, colors] of Object.entries(colorMap)) {
    console.log(`  "${plan}": ${colors.join(', ')}`)
  }

  await page.waitForTimeout(5000) // pause to visually inspect
  await browser.close()
}

main().catch(console.error)
