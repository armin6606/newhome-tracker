/**
 * fix-duplicates.ts
 * Find and remove duplicate (communityId, lotNumber) listings,
 * keeping the most recently updated one.
 */
import { prisma } from "../lib/db"

async function main() {
  // Find all communities with duplicate lotNumbers
  const dupes = await (prisma as any).$queryRawUnsafe(`
    SELECT c.name, l."lotNumber", l."communityId", COUNT(*) as cnt
    FROM "Listing" l
    JOIN "Community" c ON c.id = l."communityId"
    WHERE l."lotNumber" IS NOT NULL
    GROUP BY l."communityId", l."lotNumber", c.name
    HAVING COUNT(*) > 1
    ORDER BY c.name, l."lotNumber"
  `)

  if (!dupes.length) {
    console.log("No duplicates found.")
    return
  }

  console.log(`Found ${dupes.length} duplicate (communityId, lotNumber) pairs:`)
  for (const d of dupes) {
    console.log(`  ${d.name} — lot ${d.lotNumber} × ${d.cnt}`)
  }

  // For each duplicate group, keep the one with the latest updatedAt, delete the rest
  let totalDeleted = 0
  for (const d of dupes) {
    const listings = await prisma.listing.findMany({
      where: { communityId: d.communityId, lotNumber: d.lotNumber },
      orderBy: { firstDetected: "desc" },
    })
    // Keep index 0 (most recent firstDetected), delete the rest
    const toDelete = listings.slice(1).map(l => l.id)
    await prisma.listing.deleteMany({ where: { id: { in: toDelete } } })
    console.log(`  Deleted ${toDelete.length} duplicate(s) for ${d.name} lot ${d.lotNumber}`)
    totalDeleted += toDelete.length
  }

  console.log(`\nDone. Removed ${totalDeleted} duplicate listings.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
