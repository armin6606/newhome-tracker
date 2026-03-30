import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Birch-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // Scroll to site plan area first
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(2000)

  // Get detailed option info from the siteplanselection select
  const selectInfo = await page.evaluate(() => {
    const sel = document.getElementById('siteplanselection') as HTMLSelectElement | null
    if (!sel) return null
    return {
      currentValue: sel.value,
      selectedIndex: sel.selectedIndex,
      options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }))
    }
  })
  console.log("=== siteplanselection select ===")
  console.log(JSON.stringify(selectInfo, null, 2))

  // Now try selecting the Birch-specific plan (index 1 if it exists)
  if (selectInfo && selectInfo.options.length > 1) {
    const birchOption = selectInfo.options.find(o => /birch/i.test(o.text))
    if (birchOption && !birchOption.selected) {
      console.log(`\nSelecting Birch option: value="${birchOption.value}"`)
      await page.select('#siteplanselection', birchOption.value)
      await page.waitForTimeout(3000)
      
      // Check SVG lot counts after selection
      const lotCounts = await page.evaluate(() => {
        const lots = Array.from(document.querySelectorAll('g[id]'))
          .filter(g => /^LOTS-\d+$/.test(g.id))
          .flatMap(g => Array.from(g.querySelectorAll('polygon, path, rect')))
          .map(el => (el as HTMLElement).dataset['lot_status'] || '')
          .filter(Boolean)
        const counts: Record<string, number> = {}
        lots.forEach(s => { counts[s] = (counts[s] || 0) + 1 })
        return { total: lots.length, counts }
      })
      console.log("Lot counts after selecting Birch plan:", JSON.stringify(lotCounts))
    } else if (birchOption?.selected) {
      console.log("Birch option is ALREADY selected!")
      const lotCounts = await page.evaluate(() => {
        const lots = Array.from(document.querySelectorAll('g[id]'))
          .filter(g => /^LOTS-\d+$/.test(g.id))
          .flatMap(g => Array.from(g.querySelectorAll('polygon, path, rect')))
          .map(el => (el as HTMLElement).dataset['lot_status'] || '')
          .filter(Boolean)
        const counts: Record<string, number> = {}
        lots.forEach(s => { counts[s] = (counts[s] || 0) + 1 })
        return { total: lots.length, counts }
      })
      console.log("Current lot counts:", JSON.stringify(lotCounts))
    }
  }

  await browser.close()
}
main().catch(console.error)
