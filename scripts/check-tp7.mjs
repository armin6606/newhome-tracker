import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

// Intercept all requests — specifically the community map
const mapRequests = []
page.on('response', async (resp) => {
  const url = resp.url()
  if (url.includes('cookielaw') || url.includes('marketo') || url.includes('lpsnmedia') || url.includes('analytics') || url.includes('agkn') || url.includes('yimg') || url.includes('nextdoor') || url.includes('pixel') || url.includes('salesforce') || url.includes('monitoring') || url.includes('consentjs')) return
  try {
    const text = await resp.text().catch(() => '')
    if (text.length > 100) {
      mapRequests.push({ url: url.slice(0, 200), status: resp.status(), ct: resp.headers()['content-type']?.slice(0, 50), body: text.slice(0, 800) })
    }
  } catch {}
})

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

// Click "Open Community Map"
const mapBtnClicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('a, button'))
  const btn = btns.find(b => /open community map/i.test(b.textContent?.trim()))
  if (btn) {
    console.log('Found btn:', btn.tagName, btn.href || btn.getAttribute('href'))
    btn.click()
    return { text: btn.textContent?.trim(), href: btn.href || btn.getAttribute('href') }
  }
  return null
})
console.log('Map button clicked:', mapBtnClicked)
await page.waitForTimeout(5000)

// Check what URL we're on now
const currentUrl = page.url()
console.log('Current URL after click:', currentUrl)

// Check what changed - new page text
const newText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || '')
console.log('Page text after map click:', newText.slice(0, 1000))

// Filter for interesting requests
const interesting = mapRequests.filter(r => {
  return r.url.includes('tripointehomes') || r.url.includes('algolia') || r.url.includes('contentful') || r.url.includes('cloudinary')
})

console.log('\nInteresting requests:', interesting.length)
interesting.forEach(r => {
  console.log(r.status, r.ct, r.url)
  console.log('  body:', r.body.slice(0, 300))
})

await browser.close()
