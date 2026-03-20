/**
 * Scrape Pulte OC communities by calling their internal API directly.
 * The Pulte site exposes /api/plan/qmiplans?communityId=XXX for available homes.
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const COMMUNITIES = [
  { name: "Icon at Luna Park",     city: "Irvine", communityId: "211549", url: "https://www.pulte.com/homes/california/orange-county/irvine/icon-at-luna-park-211549" },
  { name: "Parallel at Luna Park", city: "Irvine", communityId: "211550", url: "https://www.pulte.com/homes/california/orange-county/irvine/parallel-at-luna-park-211550" },
  { name: "Arden at Luna Park",    city: "Irvine", communityId: "211653", url: "https://www.pulte.com/homes/california/orange-county/irvine/arden-at-luna-park-211653" },
  { name: "Eclipse at Luna Park",  city: "Irvine", communityId: "211654", url: "https://www.pulte.com/homes/california/orange-county/irvine/eclipse-at-luna-park-211654" },
]

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")
    .replace(/\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?/gi, "")
    .replace(/\s+/g, " ").trim()
}

async function fetchQmiPlans(page, communityId) {
  const apiUrl = `https://www.pulte.com/api/plan/qmiplans?communityId=${communityId}`
  try {
    const resp = await page.request.get(apiUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.pulte.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      }
    })
    if (!resp.ok()) { console.log(`  API ${apiUrl} returned ${resp.status()}`); return [] }
    const data = await resp.json()
    return data
  } catch (e) {
    console.log(`  Error fetching QMI plans: ${e.message?.slice(0,60)}`)
    return []
  }
}

function extractListings(data) {
  const homes = []
  // data may be array or object with array inside
  const items = Array.isArray(data) ? data : (data?.plans || data?.qmiPlans || data?.homes || [])
  for (const item of items) {
    // Each item may have multiple QMI homes under item.qmiHomes or item.homes
    const qmiHomes = item?.qmiHomes || item?.homes || (item?.address ? [item] : [])
    for (const home of qmiHomes) {
      const addrObj = home?.address
      const address = addrObj?.street1?.trim() || addrObj?.street || addrObj?.streetAddress || home?.streetAddress || (typeof addrObj === 'string' ? addrObj : null)
      const price = home?.price || home?.basePrice || home?.listPrice
      const beds = home?.beds || home?.bedrooms || item?.beds || item?.bedrooms
      const baths = home?.baths || home?.bathrooms || item?.baths || item?.bathrooms
      const sqft = home?.sqft || home?.squareFeet || item?.sqft || item?.squareFeet
      const floors = home?.stories || home?.floors || item?.stories || item?.floors
      const hoa = home?.hoa || home?.hoaFees || home?.monthlyHoa
      const moveIn = home?.moveInDate || home?.estimatedCompletionDate || home?.availableDate
      const plan = home?.planName || item?.planName || item?.name
      const lot = home?.lotNumber || home?.homesite || home?.homesiteNumber
      const garages = home?.garages || home?.garageSpaces || item?.garages

      if (address || price) {
        homes.push({ address, price, beds, baths, sqft, floors, hoa, moveIn, plan, lot, garages })
      }
    }
  }
  return homes
}

async function main() {
  const builder = await prisma.builder.findFirst({ where: { name: "Pulte Homes" } })
  if (!builder) { console.log("Builder not found"); process.exit(1) }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  })
  const page = await context.newPage()

  // Warm up with a page visit to get cookies/headers right
  await page.goto("https://www.pulte.com/homes/california/orange-county/irvine/icon-at-luna-park-211549", { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(3000)

  let totalCreated = 0

  for (const comm of COMMUNITIES) {
    console.log(`\n── ${comm.name} ──`)

    // Get or create community
    const community = await prisma.community.upsert({
      where: { builderId_name: { builderId: builder.id, name: comm.name } },
      create: { builderId: builder.id, name: comm.name, city: comm.city, state: "CA", url: comm.url },
      update: { city: comm.city, url: comm.url }
    })

    // Fetch QMI plans from API
    const raw = await fetchQmiPlans(page, comm.communityId)
    console.log(`  API returned type: ${Array.isArray(raw) ? 'array['+raw.length+']' : typeof raw}`)
    if (Array.isArray(raw) && raw.length > 0) {
      console.log(`  First item keys: ${Object.keys(raw[0]).join(", ")}`)
      // Log first item deeply
      const first = raw[0]
      const sub = first?.qmiHomes || first?.homes
      if (sub) console.log(`  Sub-items count: ${sub.length}, first keys: ${sub[0] ? Object.keys(sub[0]).join(", ") : 'n/a'}`)
    }

    const homes = extractListings(raw)
    console.log(`  Found ${homes.length} homes`)

    // Get current active listings for sold detection
    const activeDbListings = await prisma.listing.findMany({
      where: { communityId: community.id, status: "active" }
    })
    const foundAddresses = new Set()

    for (const h of homes) {
      const addr = cleanAddress(typeof h.address === 'object' ? JSON.stringify(h.address) : h.address)
      console.log(`    Raw address: ${JSON.stringify(h.address)} → cleaned: ${addr}`)
      console.log(`    price:${h.price} beds:${h.beds} baths:${h.baths} sqft:${h.sqft} floors:${h.floors} plan:${h.plan}`)

      if (!addr || !/^\d/.test(addr)) {
        console.log(`    ✗ Skipping — no valid address`)
        continue
      }

      foundAddresses.add(addr)

      const price = typeof h.price === 'number' ? h.price : parseInt(String(h.price || "").replace(/[^0-9]/g, "")) || null

      try {
        const existing = await prisma.listing.findFirst({ where: { communityId: community.id, address: addr } })
        if (existing) {
          await prisma.listing.update({ where: { id: existing.id }, data: {
            currentPrice: price, beds: h.beds, baths: h.baths, sqft: h.sqft,
            floors: h.floors, hoaFees: h.hoa, moveInDate: h.moveIn, floorPlan: h.plan, lotNumber: String(h.lot || ""), status: "active"
          }})
          console.log(`    ↻ Updated [${existing.id}]`)
        } else {
          const listing = await prisma.listing.create({ data: {
            communityId: community.id, address: addr, currentPrice: price,
            beds: h.beds, baths: h.baths, sqft: h.sqft, floors: h.floors,
            hoaFees: h.hoa, moveInDate: h.moveIn, floorPlan: h.plan, lotNumber: String(h.lot || ""),
            status: "active", sourceUrl: comm.url
          }})
          if (price) await prisma.priceHistory.create({ data: { listingId: listing.id, price, changeType: "initial" } })
          console.log(`    ✓ Created [${listing.id}] ${addr} $${price?.toLocaleString()}`)
          totalCreated++
        }
      } catch (e) { console.log(`    Error: ${e.message?.slice(0, 80)}`) }
    }

    // Mark active DB listings not found in API as removed (sold)
    for (const dbL of activeDbListings) {
      if (!foundAddresses.has(dbL.address)) {
        await prisma.listing.update({ where: { id: dbL.id }, data: { status: "removed", soldAt: new Date() } })
        console.log(`    ✗ Marked removed [${dbL.id}] "${dbL.address}" (not in API response)`)
      }
    }
  }

  await browser.close()
  console.log(`\nTotal created: ${totalCreated}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
