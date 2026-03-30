/**
 * Scrape Del Webb communities by calling their internal API directly.
 * Del Webb is part of Pulte Group and uses the identical API format:
 * https://www.delwebb.com/api/plan/qmiplans?communityId=XXXXX
 * Uses diff-based logic: compares API response to DB and only POSTs changes to ingest.
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const BUILDER_NAME    = "Del Webb"
const INGEST_URL      = "https://www.newkey.us/api/ingest"
const INGEST_SECRET   = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const DELWEBB_BASE_URL = "https://www.delwebb.com"

const COMMUNITIES = [
  {
    dbId:        79,
    name:        "Luna at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    communityId: "211498",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498",
  },
  {
    dbId:        168,
    name:        "Elara at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    communityId: "211497",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/elara-at-gavilan-ridge-211497",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanAddress(raw) {
  if (!raw) return null
  return raw
    .replace(/,.*$/, "")
    .replace(/\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?/gi, "")
    .replace(/\s+/g, " ").trim()
}

async function getDbActive(communityName, builderName) {
  const listings = await prisma.listing.findMany({
    where: {
      status: "active",
      community: {
        name:    communityName,
        builder: { name: builderName },
      },
    },
    select: { id: true, address: true, lotNumber: true, currentPrice: true },
  })
  return {
    byAddress:   new Map(listings.filter(l => l.address).map(l => [l.address, l])),
    byLotNumber: new Map(listings.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
  }
}

async function postToIngest(communityName, communityCity, communityUrl, listings) {
  if (!listings.length) return
  const payload = {
    builder:   { name: BUILDER_NAME, websiteUrl: DELWEBB_BASE_URL },
    community: { name: communityName, city: communityCity, state: "CA", url: communityUrl },
    listings,
  }
  try {
    const res = await fetch(INGEST_URL, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-ingest-secret": INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) {
      console.log(`  Ingest error ${res.status}: ${JSON.stringify(json)}`)
    } else {
      console.log(`  Ingest OK — created:${json.created} updated:${json.updated} priceChanges:${json.priceChanges}`)
    }
  } catch (e) {
    console.log(`  Ingest fetch error: ${e.message?.slice(0, 80)}`)
  }
}

// ---------------------------------------------------------------------------
// QMI API
// ---------------------------------------------------------------------------

async function fetchQmiPlans(communityId) {
  const apiUrl = `${DELWEBB_BASE_URL}/api/plan/qmiplans?communityId=${communityId}`
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "Accept":     "application/json",
        "Referer":    `${DELWEBB_BASE_URL}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    })
    if (!resp.ok) { console.log(`  API ${apiUrl} returned ${resp.status}`); return [] }
    return await resp.json()
  } catch (e) {
    console.log(`  Error fetching QMI plans: ${e.message?.slice(0, 60)}`)
    return []
  }
}

function extractListings(data, communityUrl) {
  const homes = []
  const items = Array.isArray(data) ? data : (data?.plans || data?.qmiPlans || data?.homes || [])
  for (const item of items) {
    const qmiHomes = item?.qmiHomes || item?.homes || (item?.address ? [item] : [])
    for (const home of qmiHomes) {
      const addrObj    = home?.address
      const rawAddress = addrObj?.street1?.trim() || addrObj?.street || addrObj?.streetAddress || home?.streetAddress || (typeof addrObj === "string" ? addrObj : null)
      const price      = home?.price || home?.basePrice || home?.listPrice
      const beds       = home?.beds  || home?.bedrooms  || item?.beds  || item?.bedrooms
      const baths      = home?.baths || home?.bathrooms || item?.baths || item?.bathrooms
      const sqft       = home?.squareFeet || home?.sqft || item?.squareFeet || item?.sqft
      const floors     = home?.floors || home?.stories  || item?.floors || item?.stories
      const garages    = home?.garages || home?.garageSpaces || item?.garages
      const hoa        = home?.hoa    || home?.hoaFees  || home?.monthlyHoa
      const moveIn     = home?.moveInDate || home?.estimatedCompletionDate || home?.availableDate
      const plan       = home?.floorPlan || home?.planName || item?.floorPlan || item?.planName || item?.name
      const lot        = home?.lotNumber || home?.lotBlock || home?.homesite || home?.homesiteNumber
      const sourceUrl  = home?.inventoryPageURL || home?.inventoryPageUrl || home?.detailUrl || communityUrl

      if (rawAddress || price) {
        homes.push({ rawAddress, price, beds, baths, sqft, floors, garages, hoa, moveIn, plan, lot, sourceUrl })
      }
    }
  }
  return homes
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Builder: ${BUILDER_NAME}`)
  let totalNew = 0, totalSold = 0, totalPriceChanged = 0

  for (const comm of COMMUNITIES) {
    console.log(`\n── ${comm.name} (communityId=${comm.communityId}, dbId=${comm.dbId}) ──`)

    // 1. Fetch current for-sale homes from API
    const raw   = await fetchQmiPlans(comm.communityId)
    const homes = extractListings(raw, comm.url)
    console.log(`  API returned ${homes.length} homes`)

    // 2. Load active DB listings
    const db = await getDbActive(comm.name, BUILDER_NAME)

    // 3. Diff
    const toIngest = []

    // Build maps of API homes keyed by cleaned address and lot number
    const apiByAddress = new Map()
    const apiByLot     = new Map()

    for (const h of homes) {
      const addr = cleanAddress(h.rawAddress)
      if (addr && /^\d/.test(addr)) apiByAddress.set(addr, h)
      const lotStr = h.lot ? String(h.lot) : null
      if (lotStr) apiByLot.set(lotStr, h)
    }

    // NEW: in API but not active in DB
    for (const [addr, h] of apiByAddress) {
      const dbEntry = db.byAddress.get(addr) || (h.lot && db.byLotNumber.get(String(h.lot)))
      if (!dbEntry) {
        // Brand-new listing
        const price = typeof h.price === "number" ? h.price : parseInt(String(h.price || "").replace(/[^0-9]/g, "")) || null
        toIngest.push({
          address:      addr,
          lotNumber:    h.lot ? String(h.lot) : undefined,
          currentPrice: price || undefined,
          moveInDate:   h.moveIn || undefined,
          status:       "active",
          sourceUrl:    h.sourceUrl || comm.url,
        })
        console.log(`  + New: ${addr} $${price?.toLocaleString()}`)
        totalNew++
      } else {
        // PRICE CHANGE: in both, but price differs
        const price = typeof h.price === "number" ? h.price : parseInt(String(h.price || "").replace(/[^0-9]/g, "")) || null
        if (price !== null && dbEntry.currentPrice !== price) {
          toIngest.push({
            address:      addr,
            lotNumber:    h.lot ? String(h.lot) : undefined,
            currentPrice: price,
            moveInDate:   h.moveIn || undefined,
            status:       "active",
            sourceUrl:    h.sourceUrl || comm.url,
          })
          console.log(`  ~ Price change: ${addr} $${dbEntry.currentPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
          totalPriceChanged++
        }
      }
    }

    // SOLD: active in DB with real address but NOT in API response
    for (const [addr, dbEntry] of db.byAddress) {
      const stillInApi = apiByAddress.has(addr) || (dbEntry.lotNumber && apiByLot.has(dbEntry.lotNumber))
      if (!stillInApi) {
        toIngest.push({ address: addr, status: "sold" })
        console.log(`  - Sold: ${addr}`)
        totalSold++
      }
    }

    // 4. POST to ingest only if there are changes
    if (toIngest.length > 0) {
      console.log(`  Posting ${toIngest.length} change(s) to ingest...`)
      await postToIngest(comm.name, comm.city, comm.url, toIngest)
    } else {
      console.log("  No changes detected.")
    }
  }

  console.log(`\n${"─".repeat(50)}`)
  console.log(`New: ${totalNew}  Sold: ${totalSold}  Price changes: ${totalPriceChanged}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
