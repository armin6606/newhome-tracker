import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
await page.goto('https://www.tripointehomes.com/ca/orange-county/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

const data = await page.evaluate(() => {
  // Look for listing cards
  const selectors = ['[class*="listing"]', '[class*="Listing"]', '[class*="home-card"]', '[class*="HomeCard"]', '[class*="result"]', 'article', '[data-testid]']
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel)
    if (els.length > 0) {
      return { sel, count: els.length, sample: Array.from(els).slice(0,2).map(e => ({ cls: e.className.slice(0,60), txt: e.textContent?.trim().slice(0,150) })) }
    }
  }
  // Try to find price + address combos
  const allText = document.body.innerText
  const blocks = allText.split('\n\n').filter(b => b.includes('$') && b.includes('SQ. FT'))
  return { blocks: blocks.slice(0,3) }
})
console.log(JSON.stringify(data, null, 2))
await browser.close()
