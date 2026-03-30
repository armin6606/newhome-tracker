import { chromium } from "playwright"

const COMMUNITY_URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(COMMUNITY_URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  // Dump all text content that mentions HOA, tax, fee, mello, assessment
  const found = await page.evaluate(() => {
    const results: string[] = []
    const all = Array.from(document.querySelectorAll('*'))
    for (const el of all) {
      if (el.children.length > 0) continue // leaf nodes only
      const text = (el as HTMLElement).innerText?.trim() || ''
      if (!text || text.length > 200) continue
      if (/hoa|homeowner|mello|tax|assessment|fee|monthly/i.test(text)) {
        const parent = (el.parentElement as HTMLElement)?.innerText?.trim().substring(0, 120) || ''
        results.push(`[${el.tagName}] "${text}" | parent: "${parent}"`)
      }
    }
    return [...new Set(results)].slice(0, 40)
  })

  console.log("HOA/Tax related text found on page:")
  found.forEach(f => console.log(" ", f))

  await browser.close()
}

main().catch(console.error)
