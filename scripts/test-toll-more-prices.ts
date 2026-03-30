import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Quick-Move-In/282842"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(2000)

  // Find all ModelCard-like elements on this detail page
  const cards = await page.evaluate(() => {
    const results: Array<{ address: string; price: string; planName: string; href: string }> = []
    document.querySelectorAll('[class*="ModelCard_modelCardContainer"], [class*="HomeCard"], [class*="homeCard"], [class*="listing-card"], [class*="ListingCard"]').forEach(card => {
      const addrEl = card.querySelector('[class*="calloutAddressWrapper"], [class*="address"], [class*="Address"]') as HTMLElement | null
      const priceEl = card.querySelector('[class*="price__adjust"], [class*="ModelCard_modelPrice"], [class*="price"]') as HTMLElement | null
      const nameEl = card.querySelector('[class*="ModelCard_name"], [class*="planName"], [class*="name"]') as HTMLElement | null
      const linkEl = (card.tagName === 'A' ? card : card.querySelector('a')) as HTMLAnchorElement | null
      results.push({
        address: addrEl?.innerText?.trim() || '',
        price: priceEl?.innerText?.trim() || '',
        planName: nameEl?.innerText?.trim().split('\n')[0] || '',
        href: linkEl?.href || '',
      })
    })
    return results.filter(r => r.price && r.price.includes('$'))
  })

  console.log(`Found ${cards.length} price cards:`)
  cards.forEach(c => console.log(`  [${c.address || 'no addr'}] plan=${c.planName} price=${c.price} → ${c.href.split('/').slice(-3).join('/')}`))

  await browser.close()
}
main().catch(console.error)
