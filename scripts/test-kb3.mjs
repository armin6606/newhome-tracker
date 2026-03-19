import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })
const page = await context.newPage()

const captured = []
page.on('response', async (res) => {
  try {
    const ct = res.headers()['content-type'] || ''
    if (ct.includes('json')) {
      const j = await res.json()
      const s = JSON.stringify(j)
      if (s.length > 200 && (s.includes('community') || s.includes('Irvine') || s.includes('price'))) {
        captured.push({ url: res.url().slice(0,120), preview: s.slice(0,300) })
      }
    }
  } catch {}
})

await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(3000)

console.log('JSON responses with community data:', captured.length)
captured.forEach(c => { console.log('\n', c.url); console.log(c.preview) })

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000))
console.log('\n--- Body text ---\n', bodyText)
await browser.close()
