/**
 * Scrape Del Webb communities by calling their internal API directly.
 * Del Webb is part of Pulte Group and uses the identical API format:
 * https://www.delwebb.com/api/plan/qmiplans?communityId=XXXXX
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const COMMUNITIES = [
  {
    dbId: 79,
    name: "Luna at Gavilan Ridge",
    city: "Rancho Mission Viejo",
    communityId: "211498",
    url: "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498"
  },
  {
    dbId: 168,
    name: "Elara at Gavilan Ridge",
    city: "Rancho Mission Viejo",
    communityId: "211497",
    url: "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/elara-at-gavilan-ridge-211497"
  },
]

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")
    .replace(/\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?/gi, "")
    .replace(/\s+/g, " ").trim()
}

async function fetchQmiPlans(page, communityId) {
  const apiUrl = `https://www.delwebb.com/api/plan/qmiplans?communityId=${communityId}`
  try {
    const resp = await page.request.get(apiUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.delwebb.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      }
    })
    if (!resp.ok()) {
      console.log(`  API ${apiUrl} returned ${resp.status()}`)
      return []
    }
    const data = await resp.json()
    return data
  } catch (e) {
    console.log(`  Error fetching QMI plans: ${e.message?.slice(0, 60)}`)
    return []
  }
}

function extractListings(data, communityUrl) {
  const homes = []
  // data may be array or object with array inside
  const items = Array.isArray(data) ? data : (data?.plans || data?.qmiPlans || data?.homes || [])
  for (const item of items) {
    // Each item may have multiple QMI homes under item.qmiHomes or item.homes
    const qmiHomes = item?.qmiHomes || item?.homes || (item?.address ? [item] : [])
    for (const home of qmiHomes) {
      const addrObj = home?.address
      // Per task spec: extract street1.trim() as the address
      const rawAddress = addrObj?.street1?.trim() || addrObj?.street || addrObj?.streetAddress || home?.streetAddress || (typeof addrObj === 'string' ? addrObj : null)

      const price = home?.price || home?.basePrice || home?.listPrice
      const beds = home?.beds || home?.bedrooms || item?.beds || item?.bedrooms
      const baths = home?.baths || home?.bathrooms || item?.baths || item?.bathrooms
      // Per task spec: squareFeet field
      const sqft = home?.squareFeet || home?.sqft || item?.squareFeet || item?.sqft
      // Per task spec: floors field
      const floors = home?.floors || home?.stories || item?.floors || item?.stories
      const garages = home?.garages || home?.garageSpaces || item?.garages
      const hoa = home?.hoa || home?.hoaFees || home?.monthlyHoa
      // Per task spec: moveInDate field
      const moveIn = home?.moveInDate || home?.estimatedCompletionDate || home?.availableDate
      // Per task spec: floorPlan field
      const plan = home?.floorPlan || home?.planName || item?.floorPlan || item?.planName || item?.name
      // Per task spec: lotNumber field
      const lot = home?.lotNumber || home?.lotBlock || home?.homesite || home?.homesiteNumber
      // Per task spec: inventoryPageURL field as sourceUrl
      const sourceUrl = home?.inventoryPageURL || home?.inventoryPageUrl || home?.detailUrl || communityUrl

      if (rawAddress || price) {
        homes.push({ rawAddress, price, beds, baths, sqft, floors, garages, hoa, moveIn, plan, lot, sourceUrl })
      }
    }
  }
  return homes
}

async function main() {
  const builder = await prisma.builder.findFirst({ where: { name: "Del Webb" } })
  if (!builder) { console.log("Builder 'Del Webb' not found"); process.exit(1) }
  console.log(`Builder: Del Webb (id=${builder.id})`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  })
  const page = await context.newPage()

  // Warm up: visit Del Webb site to get cookies/session
  console.log("\nWarming up on Del Webb site...")
  await page.goto(COMMUNITIES[0].url, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(3000)
  console.log("Warm-up complete.")

  let totalCreated = 0
  let totalUpdated = 0
  let totalRemoved = 0

  for (const comm of COMMUNITIES) {
    console.log(`\n── ${comm.name} (communityId=${comm.communityId}, dbId=${comm.dbId}) ──`)

    // Use the existing community by dbId
    const community = await prisma.community.findUnique({ where: { id: comm.dbId } })
    if (!community) {
      console.log(`  Community id=${comm.dbId} not found in DB, skipping`)
      continue
    }

    // Fetch QMI plans from Del Webb API
    const raw = await fetchQmiPlans(page, comm.communityId)
    console.log(`  API returned type: ${Array.isArray(raw) ? 'array[' + raw.length + ']' : typeof raw}`)
    if (Array.isArray(raw) && raw.length > 0) {
      console.log(`  First item keys: ${Object.keys(raw[0]).join(", ")}`)
      const first = raw[0]
      const sub = first?.qmiHomes || first?.homes
      if (sub) {
        console.log(`  Sub-items count: ${sub.length}, first keys: ${sub[0] ? Object.keys(sub[0]).join(", ") : 'n/a'}`)
      }
    }

    const homes = extractListings(raw, comm.url)
    console.log(`  Found ${homes.length} homes in API response`)

    // Get current active listings from DB for this community
    const activeDbListings = await prisma.listing.findMany({
      where: { communityId: community.id, status: "active" }
    })

    // Track which addresses we found in the API response
    const foundAddresses = new Set()

    for (const h of homes) {
      const addr = cleanAddress(h.rawAddress)
      console.log(`\n    Raw address: ${JSON.stringify(h.rawAddress)} → cleaned: ${addr}`)
      console.log(`    price:${h.price} beds:${h.beds} baths:${h.baths} sqft:${h.sqft} floors:${h.floors} garages:${h.garages} plan:${h.plan} lot:${h.lot}`)
      console.log(`    moveIn:${h.moveIn} sourceUrl:${h.sourceUrl?.slice(0, 80)}`)

      if (!addr || !/^\d/.test(addr)) {
        console.log(`    ✗ Skipping — no valid address`)
        continue
      }

      foundAddresses.add(addr)

      const price = typeof h.price === 'number' ? h.price : parseInt(String(h.price || "").replace(/[^0-9]/g, "")) || null
      const sqft = h.sqft ? parseInt(String(h.sqft).replace(/[^0-9]/g, "")) || null : null
      const floors = h.floors ? parseInt(String(h.floors)) || null : null
      const garages = h.garages ? parseInt(String(h.garages)) || null : null

      const sourceUrl = h.sourceUrl || comm.url

      try {
        const existing = await prisma.listing.findFirst({
          where: { communityId: community.id, address: addr }
        })

        if (existing) {
          // Check if price changed
          const priceChanged = price !== null && existing.currentPrice !== price
          await prisma.listing.update({
            where: { id: existing.id },
            data: {
              currentPrice: price,
              beds: h.beds,
              baths: h.baths,
              sqft: sqft,
              floors: floors,
              garages: garages,
              hoaFees: h.hoa,
              moveInDate: h.moveIn,
              floorPlan: h.plan,
              lotNumber: h.lot ? String(h.lot) : null,
              status: "active",
              sourceUrl: sourceUrl
            }
          })
          if (priceChanged) {
            await prisma.priceHistory.create({
              data: { listingId: existing.id, price, changeType: "change" }
            })
            console.log(`    ↻ Updated [${existing.id}] — price changed $${existing.currentPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
          } else {
            console.log(`    ↻ Updated [${existing.id}] — no price change`)
          }
          totalUpdated++
        } else {
          const listing = await prisma.listing.create({
            data: {
              communityId: community.id,
              address: addr,
              currentPrice: price,
              beds: h.beds,
              baths: h.baths,
              sqft: sqft,
              floors: floors,
              garages: garages,
              hoaFees: h.hoa,
              moveInDate: h.moveIn,
              floorPlan: h.plan,
              lotNumber: h.lot ? String(h.lot) : null,
              status: "active",
              sourceUrl: sourceUrl
            }
          })
          if (price) {
            await prisma.priceHistory.create({
              data: { listingId: listing.id, price, changeType: "initial" }
            })
          }
          console.log(`    ✓ Created [${listing.id}] ${addr} $${price?.toLocaleString()}`)
          totalCreated++
        }
      } catch (e) {
        console.log(`    Error: ${e.message?.slice(0, 80)}`)
      }
    }

    // Mark active DB listings NOT found in API as removed
    for (const dbL of activeDbListings) {
      if (!foundAddresses.has(dbL.address)) {
        await prisma.listing.update({
          where: { id: dbL.id },
          data: { status: "removed", soldAt: new Date() }
        })
        console.log(`\n    ✗ Marked removed [${dbL.id}] ${dbL.address} (not in API response)`)
        totalRemoved++
      }
    }
  }

  await browser.close()
  console.log(`\n${"─".repeat(50)}`)
  console.log(`Created: ${totalCreated}  Updated: ${totalUpdated}  Removed: ${totalRemoved}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
