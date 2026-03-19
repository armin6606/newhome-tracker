import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' })
const page = await context.newPage()
console.log('Loading KB Home OC...')
await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

const links = await page.evaluate(() => {
  const hrefs = []
  document.querySelectorAll('a[href*="/community/"]').forEach(a => {
    hrefs.push({ href: a.href, text: a.textContent?.trim().slice(0,40) })
  })
  return hrefs.slice(0,10)
})
console.log('Community links:', links.length)
links.forEach(l => console.log(' ', l.text, '->', l.href))

const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 500))
console.log('\nPage body preview:\n', bodySnippet)
await browser.close()
