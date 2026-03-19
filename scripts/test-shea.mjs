import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
await page.goto('https://www.sheahomes.com/new-homes/california/orange-county/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)
const data = await page.evaluate(() => {
  const cs = window.communitySearch || window.communitySearchMapJsonV2
  return JSON.stringify(cs, null, 2).slice(0, 3000)
})
console.log(data)
await browser.close()
