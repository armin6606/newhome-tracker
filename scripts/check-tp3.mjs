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

const combined = allNextF.join('\n')

// The plan data starts around index 198000 with "215265"
// Let's look at the Algolia-style search result data there
const idx215265 = combined.indexOf('215265')
console.log('Plan data context (215265):')
console.log(combined.slice(Math.max(0, idx215265 - 200), idx215265 + 1500))

// Look for all plan records
const planUrls = []
const planRegex = /lavender-at-rancho-mission-viejo\/(plan-\w+-\d+)/g
let m
while ((m = planRegex.exec(combined)) !== null) {
  planUrls.push(m[1])
}
console.log('\nPlan slugs found:', [...new Set(planUrls)])

// The home_status field is important - see if there are "move_in_ready" entries
const mirIdx = combined.indexOf('move_in_ready')
console.log('\nmove_in_ready at:', mirIdx)
if (mirIdx !== -1) {
  console.log(combined.slice(Math.max(0, mirIdx - 200), mirIdx + 500))
}

// Look for "home_status"
const homeStatusIdx = combined.indexOf('"home_status"')
console.log('\nhome_status at:', homeStatusIdx)
if (homeStatusIdx !== -1) {
  // Find all occurrences
  let idx2 = homeStatusIdx
  let count = 0
  while (idx2 !== -1 && count < 10) {
    console.log(`  [${count}] at ${idx2}:`, combined.slice(idx2, idx2 + 100))
    idx2 = combined.indexOf('"home_status"', idx2 + 1)
    count++
  }
}

// Look at full plan data record
const minPriceIdx = combined.indexOf('"min_price":924907')
if (minPriceIdx !== -1) {
  console.log('\nFull plan-1 data record:')
  // Find the start of this object
  let start = minPriceIdx
  while (start > 0 && combined[start] !== '{') start--
  console.log(combined.slice(start, minPriceIdx + 800))
}

await browser.close()
