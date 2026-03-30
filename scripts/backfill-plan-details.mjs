/**
 * backfill-plan-details.mjs
 *
 * One-time backfill: push plan details (sqft, beds, baths, floors, propertyType, floorPlan)
 * to existing Pulte and Del Webb listings that are missing these fields.
 *
 * Strategy:
 *   1. Fetch Zonda map for each community → lot address/lotNumber → planName
 *   2. Match each DB listing to a plan via address or lotNumber
 *   3. POST the plan details to ingest for any listing missing sqft or beds
 *
 * Run: node scripts/backfill-plan-details.mjs
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

const { PrismaClient } = require("../node_modules/@prisma/client")
const prisma = new PrismaClient()

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"

const STREET_SUFFIXES =
  /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i

function cleanAddress(raw) {
  if (!raw) return null
  return raw.replace(/,.*$/, "").replace(STREET_SUFFIXES, "").replace(/\s+/g, " ").trim()
}

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

// ─── Communities with hardcoded Table 3 plan details ─────────────────────────

const COMMUNITIES = [
  // ── Pulte ──────────────────────────────────────────────────────────────────
  {
    builderName: "Pulte",
    builderUrl:  "https://www.pulte.com",
    name:        "Icon",
    city:        "Irvine",
    state:       "CA",
    url:         "https://www.pulte.com/homes/california/orange-county/irvine/icon-at-luna-park-211549",
    olaId:       "09341369-396d-4225-b89c-24625f0d129e",
    plans: {
      "Plan 1": { sqft: 2104, beds: 3, baths: 4,   floors: 3, propertyType: "Condominium" },
      "Plan 2": { sqft: 2276, beds: 4, baths: 3.5, floors: 3, propertyType: "Condominium" },
      "Plan 3": { sqft: 2439, beds: 4, baths: 3.5, floors: 3, propertyType: "Condominium" },
      "Plan 4": { sqft: 2608, beds: 4, baths: 3.5, floors: 3, propertyType: "Condominium" },
    },
  },
  {
    builderName: "Pulte",
    builderUrl:  "https://www.pulte.com",
    name:        "Parallel",
    city:        "Irvine",
    state:       "CA",
    url:         "https://www.pulte.com/homes/california/orange-county/irvine/parallel-at-luna-park-211550",
    olaId:       "a3bea538-d2e9-4ac7-8fad-8111f30744ef",
    plans: {
      "Plan 1": { sqft: 2060, beds: 3, baths: 3.5, floors: 3, propertyType: "Condominium" },
      "Plan 2": { sqft: 2352, beds: 3, baths: 3.5, floors: 3, propertyType: "Condominium" },
      "Plan 3": { sqft: 2371, beds: 3, baths: 3.5, floors: 3, propertyType: "Condominium" },
    },
  },
  // ── Del Webb ───────────────────────────────────────────────────────────────
  {
    builderName: "Del Webb",
    builderUrl:  "https://www.delwebb.com",
    name:        "Luna at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    state:       "CA",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498",
    olaId:       "2a66dabe-28ef-4263-8b33-79ad9349ef12",
    plans: {
      "Plan 1":  { sqft: 1844, beds: 2, baths: 2.5, floors: 1, propertyType: "Single Family" },
      "Plan 2":  { sqft: 1907, beds: 2, baths: 2.5, floors: 1, propertyType: "Single Family" },
      "Plan 1X": { sqft: 2484, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 2X": { sqft: 2736, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 3":  { sqft: 2806, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
    },
  },
  {
    builderName: "Del Webb",
    builderUrl:  "https://www.delwebb.com",
    name:        "Elara at Gavilan Ridge",
    city:        "Rancho Mission Viejo",
    state:       "CA",
    url:         "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/elara-at-gavilan-ridge-211497",
    olaId:       "377e33ce-3f1f-4836-9643-46642de99a81",
    plans: {
      "Plan 1": { sqft: 2454, beds: 3, baths: 3,   floors: 2, propertyType: "Single Family" },
      "Plan 2": { sqft: 2692, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
      "Plan 3": { sqft: 2911, beds: 3, baths: 3.5, floors: 2, propertyType: "Single Family" },
    },
  },
]

// ─── Fetch Zonda lots ─────────────────────────────────────────────────────────

async function fetchZondaLots(olaId, communityName) {
  const url = `https://apps.zondavirtual.com/olajson/${olaId}.json`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  })
  if (!res.ok) throw new Error(`Zonda API ${res.status}`)
  const data = await res.json()
  const lots = data.MasterSiteplan?.LotDetails || []

  return lots.map(lot => {
    const attrs = {}
    for (const a of lot.LotAttributes || []) attrs[a.AttributeName?.toLowerCase()] = a.Value
    return {
      address:   cleanAddress(attrs["address"] || ""),
      lotNumber: lot.LotNumber ? compositeKey(communityName, lot.LotNumber) : null,
      planName:  attrs["preplotted_plan"] || attrs["homes"] || null,
    }
  })
}

// ─── POST to ingest ───────────────────────────────────────────────────────────

async function postIngest(comm, listings) {
  if (!listings.length) return null
  const payload = {
    builder:   { name: comm.builderName, websiteUrl: comm.builderUrl },
    community: { name: comm.name, city: comm.city, state: comm.state, url: comm.url },
    listings,
  }
  const res  = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Ingest error ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log("Backfill Plan Details — Pulte + Del Webb")
  console.log(new Date().toISOString())
  console.log("=".repeat(60))

  for (const comm of COMMUNITIES) {
    console.log(`\n${"─".repeat(50)}`)
    console.log(`${comm.builderName} — ${comm.name}`)

    try {
      // 1. Fetch Zonda lots to get planName per address/lotNumber
      const zondaLots = await fetchZondaLots(comm.olaId, comm.name)
      const byAddress  = new Map(zondaLots.filter(l => l.address).map(l => [l.address, l]))
      const byLotNum   = new Map(zondaLots.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))
      console.log(`  Zonda: ${zondaLots.length} lots fetched`)

      // 2. Get DB listings missing sqft or beds
      const dbListings = await prisma.listing.findMany({
        where: {
          community: { name: comm.name, builder: { name: comm.builderName } },
          status:    { not: "removed" },
          OR: [{ sqft: null }, { beds: null }],
          lotNumber: { not: { in: [] } }, // not placeholder
        },
        select: { id: true, address: true, lotNumber: true, status: true },
      })

      // Filter out placeholders
      const toFill = dbListings.filter(l => !/^(sold|avail|future)-\d+$/.test(l.lotNumber ?? ""))
      console.log(`  DB listings missing sqft/beds: ${toFill.length}`)

      if (toFill.length === 0) {
        console.log("  ✓ Nothing to backfill")
        continue
      }

      // 3. Match each DB listing to a Zonda lot → get planName → get plan details
      const toIngest = []
      for (const listing of toFill) {
        const zLot = (listing.address && byAddress.get(listing.address))
          || (listing.lotNumber && byLotNum.get(listing.lotNumber))
          || null

        const planName   = zLot?.planName || null
        const planDetails = planName ? (comm.plans[planName] || null) : null

        if (!planDetails) {
          console.log(`  ? No plan match: ${listing.address || listing.lotNumber} (planName=${planName})`)
          continue
        }

        console.log(`  ✓ ${listing.address || listing.lotNumber} → ${planName} (${planDetails.sqft} sqft, ${planDetails.beds}bd)`)
        toIngest.push({
          ...(listing.address   ? { address:   listing.address }   : {}),
          ...(listing.lotNumber ? { lotNumber: listing.lotNumber } : {}),
          status:       listing.status,
          floorPlan:    planName,
          ...planDetails,
        })
      }

      if (toIngest.length === 0) {
        console.log("  ✓ No matches found to ingest")
        continue
      }

      const result = await postIngest(comm, toIngest)
      console.log(`  Ingest OK — created:${result?.created ?? "?"} updated:${result?.updated ?? "?"}`)

    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}`)
    }
  }

  await prisma.$disconnect()
  console.log("\n" + "=".repeat(60))
  console.log("Backfill complete.")
  console.log("=".repeat(60))
}

main().catch(err => {
  console.error("Fatal:", err)
  prisma.$disconnect()
  process.exit(1)
})
