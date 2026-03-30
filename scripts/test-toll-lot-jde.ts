import { chromium } from "playwright"

const COMMUNITY_URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(COMMUNITY_URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) (el as HTMLElement).scrollIntoView()
  })
  await page.waitForTimeout(2000)

  // Check available lots for lot_style_ (individual JDE) in className
  const availableLots = await page.evaluate(() => {
    const shapes = Array.from(document.querySelectorAll('polygon[data-lot_status="Available"], path[data-lot_status="Available"]'))
    return shapes.map(s => {
      const el = s as HTMLElement
      const cls = String(el.getAttribute('class') || '')
      const m = cls.match(/lot_style_\d+_(\d+)/)
      return {
        lotNum: String(el.getAttribute('data-lot_num') || ''),
        planName: String(el.getAttribute('data-lot_name') || ''),
        lotJDE: m ? m[1] : null,
      }
    })
  })

  console.log("Available lots:")
  availableLots.forEach(l => console.log(`  Lot ${l.lotNum} (${l.planName}): lotJDE=${l.lotJDE ?? 'NONE'}`))

  // Check ModelCard links
  const modelCards = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class*="ModelCard_modelCardContainer"]'))
    return cards.map(card => {
      const linkEl = (card.tagName === 'A' ? card : card.querySelector('a')) as HTMLAnchorElement | null
      const addrEl = (card.querySelector('[class*="calloutAddressWrapper"]') || card.querySelector('[class*="address"]')) as HTMLElement | null
      const priceEl = (card.querySelector('[class*="price__adjust"]') || card.querySelector('[class*="ModelCard_modelPrice"]')) as HTMLElement | null
      return {
        address: addrEl?.innerText?.trim() || '',
        price: priceEl?.innerText?.trim() || '',
        href: linkEl?.href || '',
      }
    })
  })

  console.log("\nModelCards (homes with detail links):")
  modelCards.forEach(c => console.log(`  [${c.address}] price=${c.price} → ${c.href}`))

  await browser.close()
}
main().catch(console.error)
