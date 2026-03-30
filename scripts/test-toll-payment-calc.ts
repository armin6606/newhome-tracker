import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Quick-Move-In/282842"

async function main() {
  const browser = await chromium.launch({ headless: false })  // visible so we can see what's there
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  // Scroll all the way down to load all lazy sections
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2000)

  // Dump ALL visible text from the full page
  const fullText = await page.evaluate(() => (document.body as HTMLElement).innerText)
  const lines = fullText.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length < 300)

  console.log("All lines mentioning money/fees/tax:")
  lines.filter(l => /\$|hoa|tax|fee|mello|association|monthly|dues|assessment/i.test(l))
    .forEach(l => console.log(" ", l))

  console.log("\n\nAll class names containing 'hoa' or 'tax' or 'fee':")
  const classMatches = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="hoa" i], [class*="tax" i], [class*="fee" i], [class*="mello" i], [class*="association" i]')
    return Array.from(els).map(el => `<${el.tagName} class="${el.className}"> ${(el as HTMLElement).innerText?.trim().substring(0, 80)}`)
  })
  classMatches.forEach(c => console.log(" ", c))

  await browser.close()
}
main().catch(console.error)
