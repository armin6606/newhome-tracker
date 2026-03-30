import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Quick-Move-In/282842"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(3000)

  // Find elements containing price text near a "Home Site" or address
  const priceBlocks = await page.evaluate(() => {
    const results: string[] = []
    const allEls = Array.from(document.querySelectorAll('*'))
    for (const el of allEls) {
      if (el.children.length > 3) continue
      const text = (el as HTMLElement).innerText?.trim() || ''
      if (/\$1,[0-9]{3},000/i.test(text) && text.length < 200) {
        const parent = el.parentElement as HTMLElement | null
        const ctx = parent?.innerText?.trim().substring(0, 200) || text
        results.push(`"${ctx}"`)
      }
    }
    return [...new Set(results)].slice(0, 20)
  })

  console.log("Elements containing prices in $1Mrange:")
  priceBlocks.forEach(p => console.log(" ", p))

  await browser.close()
}
main().catch(console.error)
