import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Birch-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  // Read cards BEFORE clicking QMI tab
  const beforeCards = await page.evaluate(() => {
    const results: Array<{ addr: string; plan: string; price: string }> = []
    const seen = new Set<Element>()
    document.querySelectorAll('[class*="ModelCard_modelCardContainer"]').forEach(card => {
      if (seen.has(card)) return
      seen.add(card)
      const addrEl = card.querySelector('[class*="calloutAddressWrapper"]') as HTMLElement | null
                  || card.querySelector('[class*="address"]') as HTMLElement | null
      const nameEl = card.querySelector('[class*="ModelCard_name"]') as HTMLElement | null
      const priceEl = card.querySelector('[class*="price__adjust"], [class*="ModelCard_modelPrice"]') as HTMLElement | null
      results.push({
        addr: addrEl?.innerText?.trim() || '',
        plan: nameEl?.innerText?.trim().split('\n')[0] || '',
        price: priceEl?.innerText?.trim() || ''
      })
    })
    return results
  })
  console.log(`\nBEFORE QMI tab: ${beforeCards.length} cards`)
  beforeCards.forEach(c => console.log(`  addr="${c.addr}" plan="${c.plan}" price="${c.price}"`))

  // Click Quick Move-In tab
  for (const tabText of ["Quick Move-In", "Available Homes", "Move-In Ready"]) {
    try {
      const tab = page.locator(`a:has-text('${tabText}'), button:has-text('${tabText}')`)
      if (await tab.first().isVisible({ timeout: 2000 })) {
        console.log(`\nClicking tab: ${tabText}`)
        await tab.first().click()
        await page.waitForTimeout(2000)
        break
      }
    } catch { /* continue */ }
  }

  const afterCards = await page.evaluate(() => {
    const results: Array<{ addr: string; plan: string; price: string }> = []
    const seen = new Set<Element>()
    document.querySelectorAll('[class*="ModelCard_modelCardContainer"]').forEach(card => {
      if (seen.has(card)) return
      seen.add(card)
      const addrEl = card.querySelector('[class*="calloutAddressWrapper"]') as HTMLElement | null
                  || card.querySelector('[class*="address"]') as HTMLElement | null
      const nameEl = card.querySelector('[class*="ModelCard_name"]') as HTMLElement | null
      const priceEl = card.querySelector('[class*="price__adjust"], [class*="ModelCard_modelPrice"]') as HTMLElement | null
      results.push({
        addr: addrEl?.innerText?.trim() || '',
        plan: nameEl?.innerText?.trim().split('\n')[0] || '',
        price: priceEl?.innerText?.trim() || ''
      })
    })
    return results
  })
  console.log(`\nAFTER QMI tab: ${afterCards.length} cards`)
  afterCards.forEach(c => console.log(`  addr="${c.addr}" plan="${c.plan}" price="${c.price}"`))

  await browser.close()
}
main().catch(console.error)
