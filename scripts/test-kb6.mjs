import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()

// Capture ALL JSON API responses
const apis = []
page.on('response', async (res) => {
  try {
    const ct = res.headers()['content-type'] || ''
    if (ct.includes('json')) {
      const text = await res.text()
      if (text.length > 100) apis.push({ url: res.url().slice(0,120), body: text.slice(0,400) })
    }
  } catch {}
})

await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(8000)

// Check window state
const winData = await page.evaluate(() => {
  const keys = Object.keys(window).filter(k => k.startsWith('__') || k.includes('data') || k.includes('Data') || k.includes('store') || k.includes('Store') || k.includes('community') || k.includes('Community'))
  return keys.slice(0, 20)
})
console.log('Window globals:', winData)

console.log('\nAPI calls captured:', apis.length)
apis.slice(0,5).forEach(a => console.log('\n', a.url, '\n', a.body))
await browser.close()
