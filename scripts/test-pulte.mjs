import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()

const apis = []
page.on('response', async res => {
  try {
    const ct = res.headers()['content-type'] || ''
    if (ct.includes('json')) {
      const text = await res.text()
      if (text.includes('community') || text.includes('Community')) apis.push({ url: res.url().slice(0,120), preview: text.slice(0,300) })
    }
  } catch {}
})

await page.goto('https://www.pulte.com/homes/california/orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(3000)

// Check window globals
const winData = await page.evaluate(() => {
  const keys = Object.keys(window).filter(k => k.includes('community') || k.includes('Community') || k.includes('__') || k.includes('data') && !k.startsWith('on'))
  return keys.slice(0,15)
})
console.log('Window globals:', winData)

// Check for community cards in DOM
const cards = await page.evaluate(() => {
  const sels = ['[class*="community-card"]', '[class*="CommunityCard"]', '[class*="community-item"]', '[class*="CommunityItem"]', '[data-community]', '.community-list li']
  for (const sel of sels) {
    const els = document.querySelectorAll(sel)
    if (els.length > 0) return { sel, count: els.length, sample: (els[0]).textContent?.trim().slice(0,100) }
  }
  return { msg: 'no cards found', bodySnippet: document.body.innerText.slice(200, 1000) }
})
console.log('Cards:', JSON.stringify(cards, null, 2))

console.log('\nAPI calls with community data:', apis.length)
apis.slice(0,3).forEach(a => console.log('\n', a.url, '\n', a.preview))
await browser.close()
