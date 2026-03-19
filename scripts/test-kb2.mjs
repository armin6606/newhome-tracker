import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })
const page = await context.newPage()

// Intercept API calls
const apiCalls = []
page.on('response', async (res) => {
  const url = res.url()
  if (url.includes('api') || url.includes('search') || url.includes('communit') || url.includes('homes')) {
    const ct = res.headers()['content-type'] || ''
    if (ct.includes('json')) {
      try {
        const j = await res.json()
        apiCalls.push({ url: url.slice(0, 80), keys: Object.keys(j).slice(0, 5) })
      } catch {}
    }
  }
})

await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(3000)

console.log('API calls captured:', apiCalls.length)
apiCalls.forEach(c => console.log(' ', c.url, '->', c.keys))

// Check all links on the page
const allLinks = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && (h.includes('communit') || h.includes('home') || h.includes('irvine') || h.includes('orange')))
    .slice(0, 10)
})
console.log('\nRelevant links:', allLinks)

// Check community card classes
const cards = await page.evaluate(() => {
  const els = document.querySelectorAll('[class*="community"], [class*="Community"], [class*="card"], [class*="Card"]')
  return Array.from(els).slice(0, 5).map(el => ({ tag: el.tagName, cls: el.className.slice(0, 60), txt: el.textContent?.trim().slice(0, 50) }))
})
console.log('\nCard elements:', cards)
await browser.close()
