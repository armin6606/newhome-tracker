import { prisma } from "../lib/db"

async function main() {
  const rows = await (prisma as any).$queryRawUnsafe(`
    SELECT
      c.name,
      COUNT(l.id)::int as total_listings,
      COUNT(CASE WHEN l.status = 'active'  THEN 1 END)::int as active,
      COUNT(CASE WHEN l.status = 'sold'    THEN 1 END)::int as sold,
      COUNT(CASE WHEN l.status = 'future'  THEN 1 END)::int as future,
      COUNT(CASE WHEN l.status = 'removed' THEN 1 END)::int as removed,
      MAX(l."firstDetected") as newest_listing_added,
      MIN(l."firstDetected") as oldest_listing_added
    FROM "Community" c
    JOIN "Builder" b ON b.id = c."builderId"
    LEFT JOIN "Listing" l ON l."communityId" = c.id
    WHERE b.name = 'Del Webb'
    GROUP BY c.id, c.name
    ORDER BY newest_listing_added DESC NULLS LAST
  `)
  console.log(JSON.stringify(rows, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
