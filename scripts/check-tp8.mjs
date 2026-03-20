/**
 * Extract all plan data from TRI Pointe community pages using RSC __next_f data.
 * This extracts: plans, schools, sqft, beds, baths, garages, price, status
 */
import { chromium } from "playwright"

const COMMUNITIES = [
  {
    name: "Lavender at Rancho Mission Viejo",
    url: "https://www.tripointehomes.com/ca/orange-county/lavender-at-rancho-mission-viejo/",
  },
  {
    name: "Heatherly at Rancho Mission Viejo",
    url: "https://www.tripointehomes.com/ca/orange-county/heatherly-at-rancho-mission-viejo/",
  },
  {
    name: "Naya at Luna Park",
    url: "https://www.tripointehomes.com/ca/orange-county/naya-at-luna-park/",
  },
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36" })
const page = await context.newPage()

for (const comm of COMMUNITIES) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`Community: ${comm.name}`)
  console.log(`URL: ${comm.url}`)

  await page.goto(comm.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // Click Load More if present
  const loadMoreClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase() === 'load more')
    if (btn) { btn.click(); return true }
    return false
  })
  if (loadMoreClicked) {
    console.log('Clicked Load More')
    await page.waitForTimeout(3000)
  }

  // Get all RSC data
  const allNextF = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
    const parts = []
    for (const s of scripts) {
      const text = s.textContent?.trim() || ''
      if (text.startsWith('self.__next_f.push')) parts.push(text)
    }
    return parts.join('\n')
  })

  // Find the hits array in the RSC data
  const hitsIdx = allNextF.indexOf('"hits":[{')
  if (hitsIdx === -1) {
    console.log('No hits data found')
    // Check page text for move-in-ready
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '')
    console.log('Page text:', bodyText.slice(0, 1500))
    continue
  }

  // Extract hits array
  let depth = 1
  let i = hitsIdx + 9 // after '"hits":['
  while (i < allNextF.length && depth > 0) {
    if (allNextF[i] === '[') depth++
    else if (allNextF[i] === ']') depth--
    i++
  }
  const hitsStr = '[' + allNextF.slice(hitsIdx + 9, i - 1) + ']'

  let hits = []
  try {
    hits = JSON.parse(hitsStr)
  } catch(e) {
    console.log('Parse error:', e.message)
    console.log('Hits string (first 500):', hitsStr.slice(0, 500))
  }

  console.log(`Found ${hits.length} hits`)

  for (const h of hits) {
    console.log(`\n  Plan: ${h.title} (${h.type})`)
    console.log(`  URL: ${h.url}`)
    console.log(`  Price: $${h.display_price?.toLocaleString()} | Status: ${h.home_status} | ${h.tpg_status}`)
    console.log(`  Beds: ${h.min_bedrooms}-${h.max_bedrooms} | Baths: ${h.min_bathrooms}-${h.max_bathrooms} | Sqft: ${h.min_sq_feet}-${h.max_sq_feet} | Garages: ${h.min_garage}-${h.max_garage} | Stories: ${h.min_stories}-${h.max_stories}`)
    if (h.schools) console.log(`  Schools: ${JSON.stringify(h.schools)}`)
    if (h.school_district) console.log(`  School district: ${h.school_district}`)
    if (h.address) console.log(`  Address: ${h.address}`)
    if (h.street_address) console.log(`  Street: ${h.street_address}`)
    if (h.lot_number) console.log(`  Lot: ${h.lot_number}`)
    console.log(`  plan_type: ${h.plan_type} | availability_status: ${h.availability_status}`)
  }

  // Also check for move-in-ready homes specifically
  const mirIdx = allNextF.indexOf('"type":"Move-In Ready"')
  const mirIdx2 = allNextF.indexOf('"type":"Quick Move-In"')
  const mirIdx3 = allNextF.indexOf('"tpg_status":"move_in_ready"')
  console.log(`\nMIR indices: type="Move-In Ready" at ${mirIdx}, "Quick Move-In" at ${mirIdx2}, tpg_status="move_in_ready" at ${mirIdx3}`)

  // Also check the page body text for any MIR listings
  const bodyText = await page.evaluate(() => document.body?.innerText || '')
  const mirSection = bodyText.match(/move.in.ready.*?(\d+)\s*available/i)
  console.log('MIR section:', mirSection?.[0])

  await page.waitForTimeout(1000)
}

await browser.close()
