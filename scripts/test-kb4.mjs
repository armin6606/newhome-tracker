import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)

const data = await page.evaluate(() => {
  // Find "Tour Community" and "Explore" links and work backwards to get card container
  const results = []
  document.querySelectorAll('a[href*="/new-homes/"], button').forEach(el => {
    const txt = el.textContent?.trim()
    if (txt === 'Tour Community' || txt === 'Explore') {
      const href = el.tagName === 'A' ? el.href : ''
      const container = el.closest('[class*="card"], [class*="result"], [class*="community"], article, li, div[class*="Row"], div[class*="item"]') || el.parentElement?.parentElement
      if (container) {
        const text = container.innerText || ''
        results.push({ href, text: text.slice(0, 200), containerClass: container.className?.slice(0, 60) })
      }
    }
  })
  return results
})
console.log('Found community links:', data.length)
data.forEach(d => console.log('\nClass:', d.containerClass, '\nHref:', d.href, '\n', d.text))
await browser.close()
