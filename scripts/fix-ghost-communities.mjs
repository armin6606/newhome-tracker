/**
 * fix-ghost-communities.mjs
 *
 * 1. Merges ghost communities into their real counterparts
 * 2. Fixes Aurora for-sale count (0 → 7)
 * 3. Fixes Skyline sold count (38 → 37)
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

async function postIngest(builder, builderUrl, community, listings) {
  if (!listings.length) return
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body: JSON.stringify({ builder: { name: builder, websiteUrl: builderUrl }, community, listings }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Ingest error ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ─── Ghost community merge ────────────────────────────────────────────────────

async function mergeGhost(ghostId, realId, ghostName, realName) {
  console.log(`\n── Merging "${ghostName}" (id:${ghostId}) → "${realName}" (id:${realId})`)

  const ghostListings = await prisma.listing.findMany({
    where: { communityId: ghostId, status: { not: "removed" } },
    select: { id: true, address: true, lotNumber: true, status: true, currentPrice: true,
              sqft: true, beds: true, baths: true, floors: true, propertyType: true,
              floorPlan: true, moveInDate: true, sourceUrl: true },
  })
  console.log(`  Ghost has ${ghostListings.length} listings`)

  // Get real community's existing listings for duplicate detection
  const realListings = await prisma.listing.findMany({
    where: { communityId: realId },
    select: { id: true, address: true, lotNumber: true, status: true },
  })
  const realByAddress  = new Map(realListings.filter(l => l.address).map(l => [l.address.toLowerCase(), l]))
  const realByLotNum   = new Map(realListings.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))

  let moved = 0, updated = 0, removed = 0

  for (const gl of ghostListings) {
    const dupByAddr = gl.address ? realByAddress.get(gl.address.toLowerCase()) : null
    const dupByLot  = gl.lotNumber ? realByLotNum.get(gl.lotNumber) : null
    const duplicate = dupByAddr || dupByLot

    if (duplicate) {
      // Update real listing with ghost's latest status/price, then delete ghost
      await prisma.listing.update({
        where: { id: duplicate.id },
        data: {
          status:       gl.status,
          currentPrice: gl.currentPrice,
          ...(gl.sqft        ? { sqft: gl.sqft }               : {}),
          ...(gl.beds        ? { beds: gl.beds }               : {}),
          ...(gl.baths       ? { baths: gl.baths }             : {}),
          ...(gl.floors      ? { floors: gl.floors }           : {}),
          ...(gl.propertyType? { propertyType: gl.propertyType }: {}),
          ...(gl.floorPlan   ? { floorPlan: gl.floorPlan }     : {}),
          ...(gl.moveInDate  ? { moveInDate: gl.moveInDate }   : {}),
          ...(gl.sourceUrl   ? { sourceUrl: gl.sourceUrl }     : {}),
        },
      })
      await prisma.priceHistory.deleteMany({ where: { listingId: gl.id } })
      await prisma.listing.delete({ where: { id: gl.id } })
      console.log(`  ~ Merged duplicate: ${gl.address || gl.lotNumber} → status ${gl.status}`)
      updated++
    } else {
      // Move listing to real community
      await prisma.listing.update({ where: { id: gl.id }, data: { communityId: realId } })
      console.log(`  → Moved: ${gl.address || gl.lotNumber}`)
      moved++
    }
  }

  // Delete ghost community
  await prisma.community.delete({ where: { id: ghostId } })
  console.log(`  ✓ Ghost deleted. Moved:${moved} Updated:${updated} Removed:${removed}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log("Fix Ghost Communities + Count Mismatches")
  console.log(new Date().toISOString())
  console.log("=".repeat(60))

  // 1. Merge ghost communities
  await mergeGhost(909, 877, "Icon at Luna Park",      "Icon")
  await mergeGhost(910, 878, "Parallel at Luna Park",  "Parallel")
  await mergeGhost(907, 881, "Luna at Gavilan Ridge",  "Luna")
  await mergeGhost(908, 882, "Elara at Gavilan Ridge", "Elara")

  // 2. Fix Aurora — sheet says forSale:7 total:47, website shows forSale:0 total:40
  console.log("\n── Fix Aurora (Taylor Morrison) — add 7 for-sale placeholders")
  const auroraResult = await postIngest(
    "Taylor Morrison", "https://www.taylormorrison.com",
    { name: "Aurora", city: "Irvine", state: "CA", url: "https://www.taylormorrison.com/california/orange-county/irvine/aurora" },
    [
      { lotNumber: "avail-1", status: "active" },
      { lotNumber: "avail-2", status: "active" },
      { lotNumber: "avail-3", status: "active" },
      { lotNumber: "avail-4", status: "active" },
      { lotNumber: "avail-5", status: "active" },
      { lotNumber: "avail-6", status: "active" },
      { lotNumber: "avail-7", status: "active" },
    ]
  )
  console.log(`  Ingest OK — created:${auroraResult?.created} updated:${auroraResult?.updated}`)

  // 3. Fix Skyline — sheet says sold:37, website shows sold:38 (1 extra sold placeholder)
  console.log("\n── Fix Skyline (Toll Brothers) — remove 1 excess sold placeholder")
  const skylineSoldPlaceholders = await prisma.listing.findMany({
    where: {
      community: { name: "Skyline", builder: { name: "Toll Brothers" } },
      status: "sold",
      lotNumber: { contains: "sold-" },
    },
    orderBy: { id: "desc" },
    take: 1,
    select: { id: true, lotNumber: true },
  })
  if (skylineSoldPlaceholders.length > 0) {
    await prisma.listing.update({ where: { id: skylineSoldPlaceholders[0].id }, data: { status: "removed" } })
    console.log(`  ✓ Removed placeholder: ${skylineSoldPlaceholders[0].lotNumber}`)
  } else {
    console.log("  ? No sold placeholder found to remove")
  }

  await prisma.$disconnect()
  console.log("\n" + "=".repeat(60))
  console.log("Done.")
  console.log("=".repeat(60))
}

main().catch(err => {
  console.error("Fatal:", err)
  prisma.$disconnect()
  process.exit(1)
})
