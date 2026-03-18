/**
 * Updates Lennar listings with:
 * 1. Schools (scraped from community pages)
 * 2. Move-in dates (scraped from listing detail pages)
 * 3. Tax rate → annual taxes (scraped from listing detail pages)
 */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function communityUrlFromListingUrl(sourceUrl) {
  // sourceUrl: https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/rhea-at-luna-park/rhea-3/25403510089
  // community: https://www.lennar.com/new-homes/california/orange-county/irvine/great-park-neighborhoods/rhea-at-luna-park
  const parts = sourceUrl.split('/')
  // parts: ['https:', '', 'www.lennar.com', 'new-homes', 'california', 'orange-county', 'irvine', 'great-park-neighborhoods', 'rhea-at-luna-park', 'rhea-3', '25403510089']
  // index:   0        1   2                 3            4             5               6         7                          8                    9          10
  // We want up to index 8 (rhea-at-luna-park)
  if (parts.length > 8) {
    return parts.slice(0, 9).join('/')
  }
  return sourceUrl
}

async function scrapeSchools(page, communityUrl) {
  console.log(`  Scraping schools from: ${communityUrl}#availability`)
  try {
    await page.goto(communityUrl + '#availability', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(5000)

    const schools = await page.evaluate(() => {
      // Use the main item class but exclude the Info sub-element
      // Main: NearbySchools_schoolListItem__xxx (has school name + grade + district)
      // Info: NearbySchools_schoolListItemInfo__xxx (only grade + district — skip)
      const items = document.querySelectorAll('[class*="NearbySchools_schoolListItem"]')
      const names = []
      items.forEach(el => {
        // Skip info sub-elements (their class contains "Info")
        if (el.className?.toString().toLowerCase().includes('info')) return
        const text = el.innerText?.trim()
        if (!text) return
        // First line before \n is the school name
        const name = text.split('\n')[0].trim()
        if (name && !names.includes(name)) names.push(name)
      })
      return names
    })

    if (schools.length > 0) {
      console.log(`  Found schools: ${schools.join(', ')}`)
      return schools.join(', ')
    }
    console.log('  No schools found')
    return null
  } catch (err) {
    console.log(`  Error scraping schools: ${err.message}`)
    return null
  }
}

async function scrapeListingDetail(page, sourceUrl, currentPrice) {
  console.log(`  Scraping detail: ${sourceUrl.slice(-40)}`)
  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3500)

    return await page.evaluate((price) => {
      const body = document.body.innerText || ''

      // --- Move-in date ---
      let moveInDate = null
      // Check for availability/status elements
      const availEls = document.querySelectorAll('[class*="Availability"]')
      let statusText = ''
      availEls.forEach(el => {
        const t = el.innerText?.trim()
        if (t && t.length < 60 && !statusText) statusText = t
      })
      if (statusText) moveInDate = statusText
      if (!moveInDate) {
        const m = body.match(/Available\s+(\d{1,2}\/\d{4})/i)
        if (m) moveInDate = `Available ${m[1]}`
        else if (/quick\s*move[-\s]?in/i.test(body)) moveInDate = 'Quick Move-In'
        else if (/move[-\s]?in\s*ready/i.test(body)) moveInDate = 'Move-In Ready'
        else if (/now\s+open/i.test(body)) moveInDate = 'Now Open'
        else if (/under\s+construction/i.test(body)) moveInDate = 'Under Construction'
      }

      // --- Tax rate → annual taxes ---
      let taxes = null
      // Look for "Approximate tax rate • 1.89%"
      const taxEl = document.querySelector('[class*="FeesContainer_hoaItemWrapper"]')
      if (taxEl) {
        const taxText = taxEl.innerText?.trim()
        const taxMatch = taxText?.match(/(\d+\.?\d*)\s*%/)
        if (taxMatch && price) {
          const rate = parseFloat(taxMatch[1]) / 100
          taxes = Math.round(price * rate) // annual taxes
        }
      }
      if (!taxes) {
        // Fallback: search in body text
        const taxMatch = body.match(/Approximate tax rate\s*[•·]\s*(\d+\.?\d*)\s*%/i)
        if (taxMatch && price) {
          const rate = parseFloat(taxMatch[1]) / 100
          taxes = Math.round(price * rate) // annual taxes
        }
      }

      // --- HOA fees ---
      let hoaFees = null
      const hoaEl = document.querySelector('[class*="FeesContainer_hoaRow"]')
      if (hoaEl) {
        const hoaText = hoaEl.innerText || ''
        const lines = hoaText.split('\n').map(l => l.trim()).filter(l => l)
        for (const line of lines) {
          if (line.toLowerCase().includes('hoa') || line.toLowerCase().includes('association')) {
            const m = line.match(/\$\s*([\d,]+)/)
            if (m) { hoaFees = parseInt(m[1].replace(/,/g, ''), 10); break }
          }
        }
      }
      if (!hoaFees) {
        const hoaMatch = body.match(/HOA\s*(?:Fees?)?\s*:?\s*\$\s*([\d,]+)\s*\/\s*mo/i)
        if (hoaMatch) hoaFees = parseInt(hoaMatch[1].replace(/,/g, ''), 10)
      }

      return { moveInDate, taxes, hoaFees }
    }, currentPrice)
  } catch (err) {
    console.log(`  Error scraping detail: ${err.message}`)
    return {}
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  try {
    // Get all active Lennar listings with sourceUrl
    const listings = await prisma.listing.findMany({
      where: {
        status: 'active',
        sourceUrl: { not: null },
        community: { builder: { name: { contains: 'Lennar' } } }
      },
      select: { id: true, address: true, sourceUrl: true, currentPrice: true, communityId: true }
    })

    console.log(`Found ${listings.length} active Lennar listings`)

    // Group by community URL to scrape schools once per community
    const communityMap = new Map() // communityUrl → { schoolsText, listingIds }
    for (const l of listings) {
      const commUrl = communityUrlFromListingUrl(l.sourceUrl)
      if (!communityMap.has(commUrl)) {
        communityMap.set(commUrl, { schoolsText: null, listings: [] })
      }
      communityMap.get(commUrl).listings.push(l)
    }

    // 1. Scrape schools for each unique community
    console.log(`\n=== Scraping schools for ${communityMap.size} communities ===`)
    for (const [commUrl, data] of communityMap) {
      data.schoolsText = await scrapeSchools(page, commUrl)
      await page.waitForTimeout(1000)
    }

    // 2. Scrape move-in date + taxes for each listing, then update DB
    console.log('\n=== Scraping listing details ===')
    for (const [commUrl, data] of communityMap) {
      for (const listing of data.listings) {
        console.log(`\nProcessing: ${listing.address} (id=${listing.id})`)
        const detail = await scrapeListingDetail(page, listing.sourceUrl, listing.currentPrice)

        const updateData = {}
        if (data.schoolsText) updateData.schools = data.schoolsText
        if (detail.moveInDate) updateData.moveInDate = detail.moveInDate
        if (detail.taxes != null && detail.taxes > 0) updateData.taxes = detail.taxes
        if (detail.hoaFees != null && detail.hoaFees > 0) updateData.hoaFees = detail.hoaFees

        if (Object.keys(updateData).length > 0) {
          await prisma.listing.update({ where: { id: listing.id }, data: updateData })
          console.log(`  Updated: ${JSON.stringify(updateData)}`)
        } else {
          console.log('  No data to update')
        }

        await page.waitForTimeout(800)
      }
    }

    console.log('\n=== Done! ===')
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
