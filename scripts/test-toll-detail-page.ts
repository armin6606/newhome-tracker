import { chromium } from "playwright"

// Individual lot detail page
const DETAIL_URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Quick-Move-In/282842"
// Plan page (non-QMI lot)
const PLAN_URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Sorrel"

async function scanPage(page: any, url: string, label: string) {
  console.log(`\n=== ${label} ===`)
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  const found = await page.evaluate(() => {
    const results: string[] = []
    const all = Array.from(document.querySelectorAll('*'))
    for (const el of all) {
      if (el.children.length > 0) continue
      const text = (el as HTMLElement).innerText?.trim() || ''
      if (!text || text.length > 300) continue
      if (/hoa|homeowner|mello|tax|assessment|monthly fee|dues/i.test(text)) {
        const grandParent = el.parentElement?.parentElement as HTMLElement | null
        const ctx = grandParent?.innerText?.trim().substring(0, 150) || ''
        results.push(`"${text}" | ctx: "${ctx}"`)
      }
    }
    return [...new Set(results)].slice(0, 30)
  })

  if (found.length === 0) {
    console.log("  (nothing found — checking all numeric labels on page)")
    // Dump all label-value pairs
    const labels = await page.evaluate(() => {
      const pairs: string[] = []
      document.querySelectorAll('[class*="label"], [class*="Label"], dt, th').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim()
        if (text && text.length < 50) {
          const next = el.nextElementSibling as HTMLElement | null
          pairs.push(`${text}: ${next?.innerText?.trim() || '(no sibling)'}`)
        }
      })
      return pairs.slice(0, 40)
    })
    labels.forEach(l => console.log(" ", l))
  } else {
    found.forEach(f => console.log(" ", f))
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await scanPage(page, DETAIL_URL, "QMI Lot Detail page (Lot 64)")
  await scanPage(page, PLAN_URL, "Plan page (Sorrel)")

  await browser.close()
}
main().catch(console.error)
