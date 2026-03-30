import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Birch-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // Scroll to site plan
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(2000)

  // Check for <select> elements
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id,
      name: s.name,
      className: s.className.substring(0, 80),
      options: Array.from(s.options).map(o => o.text.trim()),
      value: s.value
    }))
  })
  console.log("=== SELECT elements ===")
  selects.forEach(s => console.log(JSON.stringify(s)))

  // Check for dropdown-like button with site plan text
  const dropdownInfo = await page.evaluate(() => {
    const results: string[] = []
    // Look for elements mentioning "Site Plan" or "Overall"
    document.querySelectorAll('*').forEach(el => {
      if ((el as HTMLElement).children.length > 5) return
      const txt = (el as HTMLElement).innerText?.trim() || ''
      if (/overall site plan|select site plan/i.test(txt) && txt.length < 200) {
        results.push(`<${el.tagName} class="${el.className.substring(0,60)}"> ${txt.substring(0,100)}`)
      }
    })
    return results.slice(0, 10)
  })
  console.log("\n=== Elements mentioning Site Plan ===")
  dropdownInfo.forEach(d => console.log(d))

  // Check for filter toggles / community names in filter panel
  const filterInfo = await page.evaluate(() => {
    const results: string[] = []
    document.querySelectorAll('[class*="filter" i], [class*="Filter"]').forEach(el => {
      const txt = (el as HTMLElement).innerText?.trim() || ''
      if (txt && txt.length < 300 && /collection|community|elm|birch|alder|rowan|laurel/i.test(txt)) {
        results.push(`<${el.tagName} class="${el.className.substring(0,60)}"> ${txt.substring(0,150)}`)
      }
    })
    return results.slice(0, 15)
  })
  console.log("\n=== Filter elements ===")
  filterInfo.forEach(f => console.log(f))

  // Check for toggle/switch inputs
  const toggleInfo = await page.evaluate(() => {
    const results: string[] = []
    document.querySelectorAll('input[type="checkbox"], [role="switch"], [class*="toggle" i], [class*="switch" i]').forEach(el => {
      const parent = (el as HTMLElement).closest('label, [class*="filter"]')
      const txt = parent ? (parent as HTMLElement).innerText?.trim().substring(0, 80) : ''
      results.push(`<${el.tagName} type="${(el as HTMLInputElement).type}" checked=${( el as HTMLInputElement).checked}> ${txt}`)
    })
    return results.slice(0, 20)
  })
  console.log("\n=== Toggle/checkbox elements ===")
  toggleInfo.forEach(t => console.log(t))

  await browser.close()
}
main().catch(console.error)
