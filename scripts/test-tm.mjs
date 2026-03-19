import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()

const apis = []
page.on('response', async res => {
  try {
    const ct = res.headers()['content-type'] || ''
    const url = res.url()
    if (ct.includes('json') && !url.includes('google') && !url.includes('pinterest') && !url.includes('cookie')) {
      const text = await res.text()
      if (text.includes('community') || text.includes('Community') || text.includes('price')) {
        apis.push({ url: url.slice(0,150), preview: text.slice(0,500) })
      }
    }
  } catch {}
})

await page.goto('https://www.taylormorrison.com/ca/orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)

console.log('APIs:', apis.length)
apis.slice(0,3).forEach(a => console.log('\n', a.url, '\n', a.preview))

// Check for card selectors
const cards = await page.evaluate(() => {
  const sels = ['[class*="community-card"]', '[class*="CommunityCard"]', '[class*="community-item"]', 'article', '[data-community]']
  for (const sel of sels) {
    const els = document.querySelectorAll(sel)
    if (els.length > 1) return { sel, count: els.length, sample: (els[0]).textContent?.trim().slice(0,150) }
  }
  return { bodyText: document.body.innerText.slice(300, 1200) }
})
console.log('\nCards:', JSON.stringify(cards, null, 2))
await browser.close()
