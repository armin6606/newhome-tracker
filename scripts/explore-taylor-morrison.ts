import { chromium } from "playwright"

const URL = "https://www.taylormorrison.com/ca/southern-california/irvine/aurora-at-luna-park"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // Get page title and basic info
  const title = await page.title()
  console.log("Title:", title)

  // Look for home/lot counts
  const bodyText = await page.evaluate(() => document.body.innerText)
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l.length < 200)
  
  // Print first 100 lines to understand structure
  console.log("\n--- Page text (first 100 lines) ---")
  lines.slice(0, 100).forEach((l, i) => console.log(`${i}: ${l}`))

  // Look for SVG or interactive map
  const hasSvg = await page.evaluate(() => document.querySelectorAll('svg').length)
  console.log("\nSVG elements:", hasSvg)

  // Look for lot/home data
  const lotData = await page.evaluate(() => {
    const results: string[] = []
    // Check for canvas
    results.push("Canvas elements: " + document.querySelectorAll('canvas').length)
    // Check for iframe
    results.push("Iframe elements: " + document.querySelectorAll('iframe').length)
    // Check for common lot map classes
    const lotEls = document.querySelectorAll('[class*="lot"], [class*="home"], [class*="site"], [class*="plot"]')
    results.push("Lot-related elements: " + lotEls.length)
    // Check data attributes
    const dataEls = document.querySelectorAll('[data-lot], [data-home], [data-status]')
    results.push("Data-lot/home/status elements: " + dataEls.length)
    return results
  })
  console.log("\n--- DOM info ---")
  lotData.forEach(l => console.log(l))

  await browser.close()
}
main().catch(console.error)
