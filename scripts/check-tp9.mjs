/**
 * Get the full plan data from TRI Pointe pages by scraping DOM
 * including schools from RSC data before Load More
 */
import { chromium } from "playwright"

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

// Lavender: get first 3 plans from RSC (Plan 1, 2, 3) with school data, then click Load More for Plan 3X
await page.goto('https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

// Extract RSC data BEFORE clicking Load More (has school data for first 3 plans)
const allNextF = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  const parts = []
  for (const s of scripts) {
    const text = s.textContent?.trim() || ''
    if (text.startsWith('self.__next_f.push')) parts.push(text)
  }
  return parts.join('\n')
})

// Find all the hits by looking for the JSON encoded string approach
// The RSC data has: "hits":[{...},{...},{...}]
// Let me look for it differently
console.log('Searching for plan data patterns...')

// Search for plan 1 data
const plan1Idx = allNextF.indexOf('"215265"')
const plan2Idx = allNextF.indexOf('"215317"')
const plan3Idx = allNextF.indexOf('"215321"')

console.log('Plan slugs by ID: 215265 at', plan1Idx, ', 215317 at', plan2Idx, ', 215321 at', plan3Idx)

// The URL format includes the plan slug, let's search for plan data by URL
const urlPattern = '/ca/orange-county/lavender-at-rancho-mission-viejo/plan-'
let idx = 0
const planData = []
while (true) {
  idx = allNextF.indexOf(urlPattern, idx)
  if (idx === -1) break
  // Find the surrounding object
  // Look backwards for start of object
  let start = idx
  let depth = 0
  let j = idx
  while (j > Math.max(0, idx - 2000)) {
    if (allNextF[j] === '{') {
      depth++
      if (depth === 1) { start = j; break }
    } else if (allNextF[j] === '}') {
      depth--
    }
    j--
  }
  // Find end of object
  depth = 1
  let end = idx + 1
  while (end < allNextF.length && depth > 0) {
    if (allNextF[end] === '{') depth++
    else if (allNextF[end] === '}') depth--
    end++
  }
  const objStr = allNextF.slice(start, end)
  if (objStr.length > 100 && objStr.length < 5000) {
    try {
      const obj = JSON.parse(objStr)
      if (obj.title || obj.min_price || obj.min_bedrooms) {
        planData.push(obj)
      }
    } catch(e) {}
  }
  idx++
}

console.log(`Found ${planData.length} plan objects`)
for (const p of planData) {
  console.log(`\n  ${p.title}: $${p.display_price} | ${p.min_bedrooms}bd | ${p.min_sq_feet}sqft | ${p.home_status}`)
  console.log(`  URL: ${p.url}`)
  if (p.schools) console.log(`  Schools: ${JSON.stringify(p.schools)}`)
  if (p.school_district) console.log(`  District: ${p.school_district}`)
}

// Now try a different approach: find the whole initialData JSON section
// It comes from "initialData\":{\"hits\":
const initDataIdx = allNextF.indexOf('initialData\\":{\\"hits\\":')
const initDataIdx2 = allNextF.indexOf('"initialData":{"hits":')
console.log('\ninitialData index (escaped):', initDataIdx, '(unescaped):', initDataIdx2)

// Try to find it as it appears in the RSC string
// The RSC data is escaped JSON within a JS string
// Let's look at a wider window around where we know the plans are
if (plan1Idx !== -1) {
  const context = allNextF.slice(Math.max(0, plan1Idx - 3000), plan1Idx + 500)
  console.log('\nContext 3000 chars before plan1 slug:')
  console.log(context.slice(0, 2000))
}

await browser.close()
