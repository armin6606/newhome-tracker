/**
 * Restores listings that were incorrectly marked as 'removed' during address cleanup.
 * Keeps only clean, unique addresses per community — skips duplicates, placeholders, and junk.
 */
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

function isCleanAddress(address, communityName) {
  if (!address) return false
  const a = address.trim()
  // Skip if it's the community name (placeholder)
  if (a.toLowerCase() === communityName.toLowerCase()) return false
  // Skip if it contains city/state
  if (/, [A-Z]{2}$/i.test(a)) return false
  if (/,\s*(california|ca)\b/i.test(a)) return false
  // Skip "Plans Available" placeholders
  if (/plans available/i.test(a)) return false
  // Skip URLs
  if (/^https?:\/\//i.test(a)) return false
  // Skip intersection addresses (contains " and ")
  if (/ and /i.test(a)) return false
  // Must contain a number to be a real address
  if (!/\d/.test(a)) return false
  return true
}

async function main() {
  // Get all communities with at least one removed listing
  const communities = await prisma.community.findMany({
    where: {
      excluded: false,
      listings: { some: { status: "removed" } }
    },
    include: {
      listings: {
        where: { status: "removed" },
        select: { id: true, address: true, currentPrice: true }
      }
    }
  })

  let totalRestored = 0
  let totalSkipped = 0

  for (const community of communities) {
    const candidates = community.listings.filter(l => isCleanAddress(l.address, community.name))
    if (!candidates.length) continue

    // Check for active listings with same address to avoid true duplicates
    const activeListings = await prisma.listing.findMany({
      where: { communityId: community.id, status: "active" },
      select: { address: true }
    })
    const activeAddresses = new Set(activeListings.map(l => l.address?.toLowerCase().trim()))

    // Deduplicate among candidates (keep one per unique address)
    const seen = new Set()
    const toRestore = []
    for (const l of candidates) {
      const key = l.address.toLowerCase().trim()
      if (!activeAddresses.has(key) && !seen.has(key)) {
        seen.add(key)
        toRestore.push(l)
      } else {
        totalSkipped++
      }
    }

    if (toRestore.length) {
      await prisma.listing.updateMany({
        where: { id: { in: toRestore.map(l => l.id) } },
        data: { status: "active" }
      })
      console.log(`✓ ${community.name}: restored ${toRestore.length} listings`)
      toRestore.forEach(l => console.log(`   ${l.address} $${l.currentPrice}`))
      totalRestored += toRestore.length
    }
  }

  await prisma.$disconnect()
  console.log(`\nDone. Restored ${totalRestored} listings, skipped ${totalSkipped} duplicates/junk.`)
}

main().catch(e => { console.error(e); process.exit(1) })
