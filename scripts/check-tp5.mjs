import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

const allNextF = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const parts = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if (text.startsWith('self.__next_f.push')) parts.push(text)
  }
  return parts.join('\n')
})

// The hits are at index 197905 (where 215265 is found)
// Let's look more broadly around there to understand the full data structure
const dataStart = 197000
console.log('RSC data around 197000:')
console.log(allNextF.slice(dataStart, dataStart + 5000))

await browser.close()
