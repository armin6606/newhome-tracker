import { chromium } from 'playwright'

async function testPage(name, url, checkFn) {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' })).newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)
    const result = await page.evaluate(checkFn)
    console.log(`\n=== ${name} ===`)
    console.log(JSON.stringify(result, null, 2).slice(0, 800))
  } catch(e) { console.log(`\n=== ${name} ERROR ===`, e.message.slice(0,100)) }
  finally { await browser.close() }
}

// Test Shea Homes
await testPage('Shea Homes', 'https://www.sheahomes.com/new-homes/california/orange-county/', () => {
  const win = window
  const keys = Object.keys(win).filter(k => k.includes('info') || k.includes('Info') || k.includes('community') || k.includes('Community') || k.includes('moreInfo'))
  const cards = Array.from(document.querySelectorAll('[class*="community"], [class*="card"], article, li[class*="listing"]')).slice(0,3).map(el => ({ cls: el.className.slice(0,40), txt: el.textContent?.trim().slice(0,100) }))
  return { windowKeys: keys, cardCount: cards.length, cards }
})
