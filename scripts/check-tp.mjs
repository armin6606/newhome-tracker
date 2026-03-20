import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/plan-2-215317', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy(0, 600))
  await page.waitForTimeout(300)
}
await page.waitForTimeout(2000)

const text = await page.evaluate(() => document.body?.innerText || '')
console.log('Plan 2 page length:', text.length)
console.log(text.slice(0, 6000))

// Look for homesite
const homesiteIdx = text.toLowerCase().indexOf('homesite')
console.log('\nhomesite found:', homesiteIdx)
if (homesiteIdx !== -1) console.log(text.slice(Math.max(0, homesiteIdx-100), homesiteIdx+500))

// Check script tags for homesite data
const scriptData = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const found = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if ((text.includes('homesite') || text.includes('Homesite') || text.includes('1124')) && text.length > 50) {
      found.push({ id: s.id, type: s.type, preview: text.slice(0, 500) })
    }
  }
  return found
})
console.log('\nScripts with homesite data:', scriptData.length)
scriptData.forEach((s, i) => console.log(i, s.id, s.type, '\n', s.preview))

await browser.close()
