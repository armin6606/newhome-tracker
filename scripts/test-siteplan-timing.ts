import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Birch-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // Scroll to site plan first
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(2000)

  // Wait for initial SVG render
  await page.waitForFunction(() => {
    const svgs = document.querySelectorAll('svg')
    for (const svg of Array.from(svgs)) {
      if (svg.getAttribute('iterated') === 'true') return true
    }
    return false
  }, { timeout: 15000 })
  console.log("Initial SVG rendered")

  // Check initial lot count
  const initialCounts = await page.evaluate(() => {
    const lots = Array.from(document.querySelectorAll('g[id]'))
      .filter(g => /^LOTS-\d+$/.test(g.id))
      .flatMap(g => Array.from(g.querySelectorAll('polygon, path, rect')))
    const names = new Set(lots.map(el => (el as HTMLElement).dataset['lot_name'] || '').filter(n => n && n !== 'no data'))
    const statuses: Record<string, number> = {}
    lots.forEach(el => {
      const s = (el as HTMLElement).dataset['lot_status'] || ''
      if (s) statuses[s] = (statuses[s] || 0) + 1
    })
    return { total: lots.length, statuses, planNames: [...names].slice(0, 10) }
  })
  console.log("BEFORE switch:", JSON.stringify(initialCounts))

  // Switch to Birch-specific plan
  await page.selectOption('#siteplanselection', '667490')
  console.log("selectOption called — waiting for SVG to refresh...")

  // Try approach 1: wait for iterated to flip false→true
  // First wait for iterated to go away (React re-renders the SVG)
  let svgRefreshed = false
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(500)
    const state = await page.evaluate(() => {
      const svgs = document.querySelectorAll('svg')
      for (const svg of Array.from(svgs)) {
        const attr = svg.getAttribute('iterated')
        if (attr !== null) return attr
      }
      return 'no-svg'
    })
    console.log(`  t=${attempt * 500}ms: iterated="${state}"`)
    if (state === 'true' && attempt > 2) { svgRefreshed = true; break }
  }

  const afterCounts = await page.evaluate(() => {
    const lots = Array.from(document.querySelectorAll('g[id]'))
      .filter(g => /^LOTS-\d+$/.test(g.id))
      .flatMap(g => Array.from(g.querySelectorAll('polygon, path, rect')))
    const names = new Set(lots.map(el => (el as HTMLElement).dataset['lot_name'] || '').filter(n => n && n !== 'no data'))
    const statuses: Record<string, number> = {}
    lots.forEach(el => {
      const s = (el as HTMLElement).dataset['lot_status'] || ''
      if (s) statuses[s] = (statuses[s] || 0) + 1
    })
    return { total: lots.length, statuses, planNames: [...names].slice(0, 10) }
  })
  console.log("\nAFTER switch:", JSON.stringify(afterCounts))
  console.log("SVG refreshed:", svgRefreshed)

  await browser.close()
}
main().catch(console.error)
