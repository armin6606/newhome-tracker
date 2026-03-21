/**
 * TRI Pointe Homes v2 Scraper
 *
 * Approach:
 * 1. For each community page, decode the RSC __next_f data to extract Algolia plan hits
 *    (includes schools, beds, baths, sqft, garages, price, status)
 * 2. For plans not in the initial RSC (require Load More), scrape from DOM
 * 3. For Heatherly, scrape the actual MIR listing (31680 Williams Way)
 * 4. Upsert into DB:
 *    - Lavender: update existing Plan 1-3X listings with school data and sqft
 *    - Heatherly: update MIR listing + Plan 2
 *    - Naya: update Plans 1-5 with sqft data
 *
 * Run: node --env-file=.env.local scripts/scrape-tripointe-v2.mjs
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
const BASE_URL = "https://www.tripointehomes.com"

const KNOWN_COMMUNITIES = [
  {
    name: "Lavender at Rancho Mission Viejo",
    slug: "lavender-at-rancho-mission-viejo",
    url: `${BASE_URL}/ca/orange-county/lavender-at-rancho-mission-viejo`,
    city: "Rancho Mission Viejo",
    state: "CA",
  },
  {
    name: "Heatherly at Rancho Mission Viejo",
    slug: "heatherly-at-rancho-mission-viejo",
    url: `${BASE_URL}/ca/orange-county/heatherly-at-rancho-mission-viejo`,
    city: "Rancho Mission Viejo",
    state: "CA",
  },
  {
    name: "Naya at Luna Park",
    slug: "naya-at-luna-park",
    url: `${BASE_URL}/ca/orange-county/naya-at-luna-park`,
    city: "Irvine",
    state: "CA",
  },
]

const SUFFIX_RE = /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr.replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim()
}

function parsePriceInt(val) {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseIntSafe(val) {
  if (val == null) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatSafe(val) {
  if (val == null) return null
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

/**
 * Decode an escaped RSC __next_f string chunk back to normal JSON string.
 * The RSC data is stored as: self.__next_f.push([1,"...escaped JSON..."])
 */
/**
 * Extract Algolia plan hits from the RSC __next_f data on a TRI Pointe page.
 * The RSC data is inside self.__next_f.push([1,"<JS-escaped RSC payload>"]).
 * The RSC payload contains the component props as JSON, including initialData.hits.
 *
 * Strategy:
 * 1. Find the chunk containing "initialData" (double-escaped as initialData\\\":{)
 * 2. Extract the raw escaped string from the push([1,"..."]) call
 * 3. Decode with JSON.parse('"' + rawStr + '"') to get the RSC payload
 * 4. Find the [false, ["$","$L46", null, {props}]] structure and parse the props
 * 5. Return props.initialData.hits
 */
function extractHitsFromRsc(allRscData) {
  const initIdx = allRscData.indexOf('initialData\\":{\\"hits\\":')
  if (initIdx === -1) return []

  const chunkStart = allRscData.lastIndexOf('self.__next_f.push([1,"', initIdx)
  if (chunkStart === -1) return []

  // Find the opening " of the string argument
  let i = chunkStart + 'self.__next_f.push([1,'.length
  while (i < allRscData.length && allRscData[i] !== '"') i++
  i++ // skip opening "

  // Collect the raw escaped string
  let rawStr = ''
  let j = i
  while (j < allRscData.length) {
    if (allRscData[j] === '\\') {
      rawStr += allRscData[j] + (allRscData[j + 1] || '')
      j += 2
    } else if (allRscData[j] === '"') {
      break
    } else {
      rawStr += allRscData[j]
      j++
    }
  }

  // Decode the JS string escaping
  let decoded
  try {
    decoded = JSON.parse('"' + rawStr + '"')
  } catch (e) {
    console.log('  RSC decode error:', e.message?.slice(0, 60))
    return []
  }

  // The decoded string is RSC flight format, e.g.:
  //   36:[false,["$","$L46",null,{sectionId:..., initialData:{hits:[...]}}]]
  // Find the props object: starts after [false,["$","$L46",null,
  const propsMarker = '[false,["$","$L46",null,'
  const propsMarkerIdx = decoded.indexOf(propsMarker)
  if (propsMarkerIdx === -1) return []

  const propsStart = propsMarkerIdx + propsMarker.length
  if (decoded[propsStart] !== '{') return []

  // Extract the props object by brace counting
  let depth = 1
  let k = propsStart + 1
  while (k < decoded.length && depth > 0) {
    if (decoded[k] === '{') depth++
    else if (decoded[k] === '}') depth--
    k++
  }
  const propsStr = decoded.slice(propsStart, k)

  try {
    const props = JSON.parse(propsStr)
    return props?.initialData?.hits || []
  } catch (e) {
    console.log('  Props parse error:', e.message?.slice(0, 60))
    return []
  }
}

/**
 * Scrape a community page to get all plan data.
 * Combines RSC extraction (for school data) with DOM scraping (for Load More plans).
 */
async function scrapeCommunityPlans(page, comm) {
  console.log(`\n  Scraping: ${comm.url}`)
  await page.goto(comm.url + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(4000)

  // Collect RSC data BEFORE Load More (has full Algolia data for first 3 plans)
  const initialRscData = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
    return scripts
      .filter(s => s.textContent?.trim().startsWith('self.__next_f.push'))
      .map(s => s.textContent?.trim())
      .join('\n')
  })

  const initialHits = extractHitsFromRsc(initialRscData)
  console.log(`  RSC hits (initial): ${initialHits.length}`)

  // Scroll to load all content
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 700))
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(1500)

  // Click Load More if it exists
  const loadMoreClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim().toLowerCase() === 'load more')
    if (btn) { btn.click(); return true }
    return false
  })
  if (loadMoreClicked) {
    await page.waitForTimeout(3000)
    console.log('  Clicked Load More')
  }

  // Get all RSC data AFTER Load More (may have more plans but may have lost school data)
  const allRscData = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
    return scripts
      .filter(s => s.textContent?.trim().startsWith('self.__next_f.push'))
      .map(s => s.textContent?.trim())
      .join('\n')
  })

  // Also scrape DOM for all visible plan cards (catches Load More plans)
  const domPlans = await page.evaluate(({ commSlug, baseUrl }) => {
    const plans = []
    const seen = new Set()

    // Look for all links to plan pages
    document.querySelectorAll('a[href]').forEach(el => {
      const href = el.getAttribute('href') || ''
      const planMatch = href.match(new RegExp(`/ca/orange-county/${commSlug}/(plan-[^/]+)/?$`))
      if (!planMatch) return
      const planSlug = planMatch[1]
      if (seen.has(planSlug)) return
      seen.add(planSlug)

      // Find card container
      const card = el.closest('article, li, [class*="card"], [class*="Card"], [class*="item"], [class*="Item"]') || el.parentElement || el
      const text = (card?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()

      // Plan name from slug
      const slugMatch = planSlug.match(/^plan-([^-]+)/i)
      const planName = slugMatch ? `Plan ${slugMatch[1].toUpperCase()}` : planSlug

      // Price
      const priceM = text.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ''), 10) : null

      // Beds
      const bedsM = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const beds = bedsM ? parseFloat(bedsM[1]) : null

      // Baths
      const bathsM = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const baths = bathsM ? parseFloat(bathsM[1]) : null

      // Sqft
      const sqftM = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      let sqft = null
      if (sqftM) {
        sqft = parseInt((sqftM[2] || sqftM[1]).replace(/,/g, ''), 10)
      }

      // Garages
      const garM = text.match(/([\d]+)\s*BAY\s*GARAGE/i)
      const garages = garM ? parseInt(garM[1], 10) : null

      // Stories
      const storiesM = text.match(/([\d]+)\s*STORIE?S?/i)
      const floors = storiesM ? parseInt(storiesM[1], 10) : null

      // Status
      let status = 'active'
      if (/coming\s*soon/i.test(text)) status = 'coming-soon'
      else if (/limited\s*availability/i.test(text)) status = 'limited'

      plans.push({
        planSlug,
        planName,
        price,
        beds,
        baths,
        sqft,
        garages,
        floors,
        status,
        sourceUrl: `${baseUrl}/ca/orange-county/${commSlug}/${planSlug}`,
      })
    })

    return plans
  }, { commSlug: comm.slug, baseUrl: BASE_URL })

  console.log(`  DOM plans: ${domPlans.length}`)

  // Also look for MIR homes (address slugs starting with digit)
  const mirHomes = await page.evaluate(({ commSlug, baseUrl }) => {
    const homes = []
    const seen = new Set()

    document.querySelectorAll('a[href]').forEach(el => {
      const href = el.getAttribute('href') || ''
      const mirMatch = href.match(new RegExp(`/ca/orange-county/${commSlug}/(\\d[^/]+)/?$`))
      if (!mirMatch) return
      const addrSlug = mirMatch[1]
      if (seen.has(addrSlug)) return
      seen.add(addrSlug)

      const card = el.closest('article, li, [class*="card"], [class*="Card"], [class*="item"], [class*="Item"]') || el.parentElement || el
      const text = (card?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()

      // Build address from slug
      let address = addrSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      // Strip street suffix
      address = address.replace(/\s+(Way|Street|St|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)$/i, '')

      const priceM = text.match(/\$([\d,]+)/)
      const price = priceM ? parseInt(priceM[1].replace(/,/g, ''), 10) : null
      const bedsM = text.match(/([\d]+)(?:-[\d]+)?\s*BEDS?/i)
      const beds = bedsM ? parseFloat(bedsM[1]) : null
      const bathsM = text.match(/([\d.]+)(?:-[\d.]+)?\s*BATHS?/i)
      const baths = bathsM ? parseFloat(bathsM[1]) : null
      const sqftM = text.match(/([\d,]+)(?:-([\d,]+))?\s*SQ\.?\s*FT\./i)
      const sqft = sqftM ? parseInt((sqftM[2] || sqftM[1]).replace(/,/g, ''), 10) : null
      const garM = text.match(/([\d]+)\s*BAY\s*GARAGE/i)
      const garages = garM ? parseInt(garM[1], 10) : null

      homes.push({
        address,
        price,
        beds,
        baths,
        sqft,
        garages,
        status: 'active',
        isMIR: true,
        sourceUrl: `${baseUrl}/ca/orange-county/${commSlug}/${addrSlug}`,
      })
    })

    return homes
  }, { commSlug: comm.slug, baseUrl: BASE_URL })

  console.log(`  MIR homes from DOM: ${mirHomes.length}`)

  // Merge RSC hits (rich data with schools) with DOM plans (broader coverage)
  // RSC hits are authoritative for the initial 3 plans; DOM covers all including Load More
  const allPlans = []

  // Build RSC hits map by plan name
  const rscByName = new Map()
  for (const h of initialHits) {
    const name = h.title
    rscByName.set(name, h)
  }

  // Merge DOM plans with RSC data
  for (const domPlan of domPlans) {
    const rscHit = rscByName.get(domPlan.planName)
    const schools = rscHit?.schools?.map(s => `${s.type}: ${s.name}`).join(' | ') || null
    const schoolDistrict = rscHit?.school_district?.[0] || null

    allPlans.push({
      type: 'plan',
      address: domPlan.planName,  // Plan name as address key
      floorPlan: domPlan.planName,
      price: domPlan.price ?? rscHit?.display_price ?? null,
      beds: domPlan.beds ?? rscHit?.min_bedrooms ?? null,
      baths: domPlan.baths ?? rscHit?.min_bathrooms ?? null,
      sqft: domPlan.sqft ?? rscHit?.min_sq_feet ?? null,
      garages: domPlan.garages ?? rscHit?.min_garage ?? null,
      floors: domPlan.floors ?? rscHit?.min_stories ?? null,
      status: domPlan.status,
      schools: schools,
      schoolDistrict,
      sourceUrl: domPlan.sourceUrl,
    })
  }

  // Add MIR homes
  for (const mir of mirHomes) {
    allPlans.push({
      type: 'mir',
      address: mir.address,
      floorPlan: null,
      price: mir.price,
      beds: mir.beds,
      baths: mir.baths,
      sqft: mir.sqft,
      garages: mir.garages,
      floors: null,
      status: mir.status,
      schools: null,
      sourceUrl: mir.sourceUrl,
    })
  }

  return allPlans
}

/**
 * Upsert a listing
 */
async function upsertListing(communityId, home) {
  const address = home.address
  if (!address || address.length < 2) return null

  const price = parsePriceInt(home.price)
  const sqft = parseIntSafe(home.sqft)
  const beds = parseFloatSafe(home.beds)
  const baths = parseFloatSafe(home.baths)
  const garages = parseIntSafe(home.garages)
  const floors = parseIntSafe(home.floors)
  const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

  const data = {
    address,
    floorPlan: home.floorPlan || null,
    sqft,
    beds,
    baths,
    garages,
    floors,
    currentPrice: price,
    pricePerSqft,
    hoaFees: home.hoaFees ? parseIntSafe(home.hoaFees) : null,
    moveInDate: home.moveInDate || null,
    status: home.status || 'active',
    sourceUrl: home.sourceUrl || null,
    schools: home.schools || null,
  }

  let existing = await prisma.listing.findFirst({ where: { communityId, address } })
  if (!existing) {
    // Case-insensitive fallback
    const all = await prisma.listing.findMany({ where: { communityId } })
    existing = all.find(l => l.address && l.address.toLowerCase() === address.toLowerCase()) || null
  }

  if (existing) {
    const oldPrice = existing.currentPrice
    await prisma.listing.update({ where: { id: existing.id }, data })
    if (price && oldPrice !== price) {
      await prisma.priceHistory.create({
        data: {
          listingId: existing.id,
          price,
          changeType: oldPrice ? (price > oldPrice ? 'increase' : 'decrease') : 'initial',
        },
      })
      console.log(`    Updated [${existing.id}] ${address}: $${oldPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
    } else {
      console.log(`    Refreshed [${existing.id}] ${address}: $${price?.toLocaleString() ?? 'N/A'} | ${beds}bd ${baths}ba ${sqft}sqft schools=${data.schools?.slice(0, 50)}`)
    }
    return { id: existing.id, created: false }
  } else {
    const created = await prisma.listing.create({ data: { communityId, ...data } })
    if (price) {
      await prisma.priceHistory.create({
        data: { listingId: created.id, price, changeType: 'initial' },
      })
    }
    console.log(`    Created [${created.id}] ${address} | $${price?.toLocaleString() ?? 'N/A'} | ${beds}bd ${baths}ba ${sqft}sqft | ${data.status}`)
    return { id: created.id, created: true }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('TRI Pointe Homes v2 Scraper')
  console.log('='.repeat(60))

  const builder = await prisma.builder.findFirst({
    where: { name: { contains: 'TRI Pointe', mode: 'insensitive' } },
  })
  if (!builder) {
    console.error('TRI Pointe builder not found')
    process.exit(1)
  }
  console.log(`Builder: [${builder.id}] ${builder.name}`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const context = await browser.newContext({ userAgent: USER_AGENT })
  const page = await context.newPage()

  try {
    const summary = []

    for (const comm of KNOWN_COMMUNITIES) {
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`Community: ${comm.name} (${comm.city})`)

      // Get or update community in DB
      let dbComm = await prisma.community.findFirst({
        where: { builderId: builder.id, name: comm.name },
      })
      if (!dbComm) {
        dbComm = await prisma.community.create({
          data: {
            builderId: builder.id,
            name: comm.name,
            city: comm.city,
            state: comm.state,
            url: comm.url,
          },
        })
        console.log(`  Created community [${dbComm.id}] "${comm.name}"`)
      } else {
        // Update city/url if needed
        const updates = {}
        if (dbComm.city !== comm.city) updates.city = comm.city
        if (dbComm.url !== comm.url) updates.url = comm.url
        if (Object.keys(updates).length > 0) {
          dbComm = await prisma.community.update({ where: { id: dbComm.id }, data: updates })
          console.log(`  Updated community [${dbComm.id}] "${comm.name}": ${JSON.stringify(updates)}`)
        } else {
          console.log(`  Community [${dbComm.id}] "${comm.name}" OK`)
        }
      }

      // Scrape the community page
      const plans = await scrapeCommunityPlans(page, comm)
      console.log(`  Total items scraped: ${plans.length}`)

      let created = 0
      let updated = 0

      // Get current active listings for this community
      const activeListings = await prisma.listing.findMany({
        where: { communityId: dbComm.id, status: { not: 'removed' } },
      })

      const foundKeys = new Set()

      for (const plan of plans) {
        console.log(`\n  → ${plan.type.toUpperCase()}: ${plan.address} | $${plan.price?.toLocaleString()} | ${plan.beds}bd ${plan.baths}ba ${plan.sqft}sqft | ${plan.status}`)
        if (plan.schools) console.log(`    Schools: ${plan.schools}`)

        foundKeys.add(plan.address)
        // Also add normalized version
        if (plan.type === 'mir') foundKeys.add(normalizeAddress(plan.address))

        const result = await upsertListing(dbComm.id, plan)
        if (result?.created) created++
        else if (result) updated++
      }

      // Mark active listings not found in this scrape as removed
      // Only do this for plans (not for plan-level listings with "Plan X" addresses)
      // We don't want to remove plans that just weren't in Load More
      for (const l of activeListings) {
        const key = l.address
        if (!foundKeys.has(key) && !foundKeys.has(normalizeAddress(key))) {
          // Only mark as removed if it's a MIR address (starts with digit)
          // Don't auto-remove floor plan listings since they may not all be scraped
          if (/^\d/.test(key)) {
            await prisma.listing.update({
              where: { id: l.id },
              data: { status: 'removed', soldAt: new Date() },
            })
            console.log(`\n  ✗ Marked removed [${l.id}] "${key}" (MIR, not found in scrape)`)
          }
        }
      }

      summary.push({ name: comm.name, dbId: dbComm.id, created, updated, total: plans.length })
      await page.waitForTimeout(1000)
    }

    // ── Fix: mark old garbage communities' listings ───────────
    console.log('\n' + '─'.repeat(60))
    console.log('Fixing old garbage communities...')

    // Community 75 "New Construction Homes in California" - has listing 110 (already removed)
    // Community 156 "Orange County, CA" - has listing 210 (already removed)
    // Community 157 "Ready" - empty
    const garbageComms = [75, 156, 157]
    for (const cid of garbageComms) {
      const listings = await prisma.listing.findMany({ where: { communityId: cid, status: { not: 'removed' } } })
      for (const l of listings) {
        await prisma.listing.update({ where: { id: l.id }, data: { status: 'removed', soldAt: new Date() } })
        console.log(`  Marked removed [${l.id}] "${l.address}" (garbage community ${cid})`)
      }
    }

    // ── Summary ───────────────────────────────────────────────
    console.log('\n' + '='.repeat(60))
    console.log('SUMMARY')
    console.log('='.repeat(60))
    for (const s of summary) {
      console.log(`${s.name} [id=${s.dbId}]: scraped=${s.total} created=${s.created} updated=${s.updated}`)
    }

    // ── Final DB state ─────────────────────────────────────────
    console.log('\n[Final DB state — all TRI Pointe communities + listings]')
    const triComms = await prisma.community.findMany({
      where: { builderId: builder.id },
      include: {
        listings: {
          select: {
            id: true, address: true, floorPlan: true, beds: true, baths: true,
            sqft: true, garages: true, currentPrice: true, hoaFees: true,
            moveInDate: true, status: true, lotNumber: true, sourceUrl: true, schools: true,
          },
          orderBy: [{ status: 'asc' }, { currentPrice: 'asc' }],
        },
      },
      orderBy: { id: 'asc' },
    })

    for (const comm of triComms) {
      const active = comm.listings.filter(l => l.status !== 'removed')
      const removed = comm.listings.filter(l => l.status === 'removed')
      console.log(`\n${comm.name} (${comm.city}) [id=${comm.id}]`)
      console.log(`  Active: ${active.length} | Removed: ${removed.length}`)
      for (const l of active) {
        const price = l.currentPrice != null ? `$${l.currentPrice.toLocaleString()}` : 'N/A'
        console.log(`  [${l.id}] ${l.address} | plan=${l.floorPlan ?? '-'} | ${price} | ${l.beds ?? '?'}bd ${l.baths ?? '?'}ba ${l.sqft ?? '?'}sqft | garages=${l.garages ?? '?'} | ${l.status}`)
        if (l.schools) console.log(`       schools: ${l.schools.slice(0, 100)}`)
      }
    }

  } finally {
    await page.close()
    await browser.close()
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  prisma.$disconnect()
  process.exit(1)
})
