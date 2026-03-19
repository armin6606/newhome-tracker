import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()

const apis = []
page.on('response', async res => {
  try {
    const ct = res.headers()['content-type'] || ''
    const url = res.url()
    if (ct.includes('json') && !url.includes('google') && !url.includes('cookie')) {
      const text = await res.text()
      if (text.length > 200) apis.push({ url: url.slice(0,120), preview: text.slice(0,400) })
    }
  } catch {}
})

await page.goto('https://risewellhomes.com/southern-california/orange-county-new-homes', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(7000)

// Check for ais-Hits items
const hits = await page.evaluate(() => {
  const els = document.querySelectorAll('.ais-Hits-item, [class*="hit"], [class*="Hit"]')
  return { count: els.length, sample: Array.from(els).slice(0,2).map(e => e.textContent?.trim().slice(0,100)) }
})
console.log('Algolia hits:', JSON.stringify(hits, null, 2))

const body = await page.evaluate(() => document.body.innerText.slice(0, 1000))
console.log('\nBody:', body)

console.log('\nAPIs:', apis.slice(0,3).map(a => a.url + '\n' + a.preview).join('\n---\n'))
await browser.close()
