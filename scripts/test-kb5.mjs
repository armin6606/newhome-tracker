import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
await page.goto('https://www.kbhome.com/new-homes-orange-county', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)

// Get ALL links on the page and count them
const allLinks = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a[href]'))
    .map(a => ({ href: a.href, txt: a.textContent?.trim().slice(0,30) }))
    .filter(a => a.href && !a.href.includes('#') && !a.href.includes('javascript'))
    .slice(0, 30)
})
console.log('All links:', allLinks.length)
allLinks.forEach(l => console.log(l.href, '|', l.txt))
await browser.close()
