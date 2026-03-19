import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })).newPage()

const apis = []
page.on('response', async res => {
  try {
    const ct = res.headers()['content-type'] || ''
    const url = res.url()
    if ((ct.includes('json') || url.includes('api')) && !url.includes('google') && !url.includes('pinterest')) {
      const text = await res.text()
      if (text.length > 50) apis.push({ url: url.slice(0,120), text: text.slice(0,300) })
    }
  } catch {}
})

await page.goto('https://www.delwebb.com/homes/california/orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

const body = await page.evaluate(() => document.body.innerText.slice(0, 1500))
console.log('Body:', body)
console.log('\nAPIs:', apis.length)
apis.slice(0,4).forEach(a => console.log('\n', a.url, '\n', a.text.slice(0,200)))
await browser.close()
