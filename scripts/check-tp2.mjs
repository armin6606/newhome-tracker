import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

// Get ALL self.__next_f script data combined
const allNextF = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const parts = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if (text.startsWith('self.__next_f.push')) {
      parts.push(text)
    }
  }
  return parts
})

console.log(`Found ${allNextF.length} __next_f script chunks`)

// Combine all content and search for plan/homesite data
const combined = allNextF.join('\n')
console.log('Total combined length:', combined.length)

// Search for key fields
const fields = ['plan', 'Plan', 'price', 'Price', 'homesite', 'Homesite', 'address', 'bedrooms', 'sqft', 'squareFeet', '215265', '215317', 'nh_']
for (const f of fields) {
  const idx = combined.indexOf(f)
  console.log(`"${f}" at:`, idx, idx !== -1 ? combined.slice(Math.max(0, idx-50), idx+200).replace(/\n/g, ' ') : '')
}

// Try to find the plans JSON
// Look for "plans" key
const plansIdx = combined.indexOf('"plans"')
console.log('\n"plans" at:', plansIdx)
if (plansIdx !== -1) {
  console.log('context:', combined.slice(plansIdx, plansIdx + 2000))
}

// Look for "homesites" key
const homesitesIdx = combined.indexOf('"homesites"')
console.log('\n"homesites" at:', homesitesIdx)
if (homesitesIdx !== -1) {
  console.log('context:', combined.slice(homesitesIdx, homesitesIdx + 2000))
}

// Look for "availableHomesites"
const ahIdx = combined.indexOf('"availableHomesites"')
console.log('\n"availableHomesites" at:', ahIdx)

// Look for "lots"
const lotsIdx = combined.indexOf('"lots"')
console.log('"lots" at:', lotsIdx)

await browser.close()
