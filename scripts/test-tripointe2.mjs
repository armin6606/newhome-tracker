import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
await page.goto('https://www.tripointehomes.com/ca/orange-county/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(3000)

const data = await page.evaluate(() => {
  const results = []
  document.querySelectorAll('[class*="container-listing"]').forEach(card => {
    const el = card
    const text = el.textContent?.trim() || ''
    // Skip the overall container
    if (text.length > 500) return
    
    const link = el.querySelector('a[href]') || el.closest('a[href]') || el.parentElement?.querySelector('a[href]')
    const href = link?.href || ''
    
    results.push({ cls: el.className.slice(0,60), href, text: text.slice(0,200) })
  })
  
  // Also check for individual home cards with addresses
  const homeCards = document.querySelectorAll('[class*="pb-7"], [class*="listing-card"]')
  homeCards.forEach(card => {
    const el = card
    const text = el.textContent?.trim() || ''
    if (!text.includes('$') && !text.includes('Beds')) return
    const link = el.querySelector('a') || el.closest('a')
    results.push({ type: 'homeCard', cls: el.className.slice(0,60), href: link?.href || '', text: text.slice(0,200) })
  })
  
  return results
})
console.log(JSON.stringify(data, null, 2))
await browser.close()
