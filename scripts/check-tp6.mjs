import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

// Intercept all JSON requests
const jsonRequests = []
page.on('response', async (resp) => {
  const url = resp.url()
  if (url.includes('cookielaw') || url.includes('marketo') || url.includes('lpsnmedia') || url.includes('gtm') || url.includes('analytics') || url.includes('agkn') || url.includes('yimg') || url.includes('nextdoor')) return
  try {
    const ct = resp.headers()['content-type'] || ''
    if (ct.includes('json')) {
      const text = await resp.text().catch(() => '')
      jsonRequests.push({ url: url.slice(0, 200), status: resp.status(), body: text.slice(0, 500) })
    }
  } catch {}
})

// Try a direct Algolia search for move-in-ready homes
await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.scrollBy(0, 600))
  await page.waitForTimeout(400)
}
await page.waitForTimeout(2000)

// Click the "Move-In Ready" tab if it exists
const tabClicked = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
  const mirTab = tabs.find(t => /move.in.ready/i.test(t.textContent?.trim()))
  if (mirTab) { mirTab.click(); return mirTab.textContent?.trim() }
  return null
})
console.log('MIR tab clicked:', tabClicked)
await page.waitForTimeout(3000)

// Also try the find-your-home page with move-in-ready filter
await page.goto('https://www.tripointehomes.com/find-your-home/ca/orange-county?type=move-in-ready', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

const mirText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '')
console.log('MIR page text:', mirText)

// Check network requests
console.log('\nAll JSON requests:')
jsonRequests.forEach(r => {
  console.log('  ', r.status, r.url)
  if (r.body.length > 5) console.log('    ', r.body.slice(0, 300))
})

await browser.close()
