import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

// Also check network for Algolia requests which may have homesite data
const algoliaRequests = []
page.on('response', async (resp) => {
  const url = resp.url()
  if (url.includes('algolia') || url.includes('tripointehomes.com')) {
    try {
      const ct = resp.headers()['content-type'] || ''
      if (ct.includes('json')) {
        const text = await resp.text().catch(() => '')
        if (text.includes('homesite') || text.includes('Homesite') || text.includes('lot') || text.includes('address')) {
          algoliaRequests.push({ url: url.slice(0, 150), body: text.slice(0, 1000) })
        }
      }
    } catch {}
  }
})

await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.scrollBy(0, 600))
  await page.waitForTimeout(300)
}
await page.waitForTimeout(2000)

console.log('Algolia/TPI requests with address/homesite:', algoliaRequests.length)
algoliaRequests.forEach(r => {
  console.log(r.url)
  console.log(r.body.slice(0, 500))
  console.log()
})

// Look at the full __next_f data around the plan data to find all 4 plans
const allNextF = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const parts = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if (text.startsWith('self.__next_f.push')) {
      parts.push(text)
    }
  }
  return parts.join('\n')
})

// Find the initialData hits section
const hitsIdx = allNextF.indexOf('"hits":[{')
if (hitsIdx !== -1) {
  // Extract the hits array
  let depth = 0
  let i = hitsIdx + 8 // skip '"hits":['
  let start = i - 1
  depth = 1 // we're inside [
  while (i < allNextF.length && depth > 0) {
    if (allNextF[i] === '[') depth++
    else if (allNextF[i] === ']') depth--
    i++
  }
  const hitsArr = allNextF.slice(start, i)
  console.log('Hits array length:', hitsArr.length)

  // Parse the hits
  try {
    const hits = JSON.parse(hitsArr)
    console.log('Number of hits:', hits.length)
    hits.forEach((h, idx) => {
      console.log(`\nHit ${idx}: ${h.title} | type: ${h.type} | $${h.display_price} | ${h.min_bedrooms}bd | ${h.min_sq_feet}sqft | status: ${h.home_status || h.tpg_status}`)
      console.log('  url:', h.url)
      if (h.address) console.log('  address:', h.address)
      if (h.street_address) console.log('  street_address:', h.street_address)
      if (h.lot_number) console.log('  lot_number:', h.lot_number)
    })
  } catch(e) {
    console.log('Parse error:', e.message)
    console.log('Hits (first 2000):', hitsArr.slice(0, 2000))
  }
}

// Also check if there's a separate API call for homesites
// Look for community ID
const nhIdx = allNextF.indexOf('nh_51900000')
console.log('\nnh_51900000 at:', nhIdx)
if (nhIdx !== -1) console.log(allNextF.slice(Math.max(0, nhIdx-100), nhIdx+300))

await browser.close()
