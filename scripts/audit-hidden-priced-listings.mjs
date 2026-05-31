import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const SUPPORTED_BUILDERS = new Set([
  "Toll Brothers",
  "Lennar",
  "Pulte",
  "Del Webb",
  "Taylor Morrison",
  "KB Home",
  "Trumark",
  "Melia Homes",
])

const PLACEHOLDER_LOT_RE = /^(sold|avail|future)-\d+$/i
const PLACEHOLDER_ADDRESS_RE = /^(?:lot|homesite|home\s*site|home-site|hs|site)\s*#?\s*[-:]?\s*[a-z0-9-]+$/i

function isRealListing(l) {
  return (
    l.address !== null &&
    !PLACEHOLDER_ADDRESS_RE.test(l.address.trim()) &&
    !(l.lotNumber && PLACEHOLDER_LOT_RE.test(l.lotNumber))
  )
}

function communityVisible(c) {
  if (!SUPPORTED_BUILDERS.has(c.builder.name)) return false

  const real = c.listings.filter(isRealListing)
  const active = real.filter((l) => l.status === "for sale" && l.currentPrice !== null).length
  const sold = real.filter((l) => l.status === "sold").length
  const future = real.filter((l) => l.status === "future").length
  const isFutureOnly = active === 0 && sold === 0 && future > 0

  return c.lastScrapedAt !== null || isFutureOnly
}

function hiddenReason(l) {
  if (!SUPPORTED_BUILDERS.has(l.community.builder.name)) return "unsupported builder"
  if (!communityVisible(l.community)) return "community hidden"
  if (l.address === null) return "missing address"
  if (/^(avail|sold|future)-/i.test(l.address.trim())) return "accounting placeholder address"
  if (PLACEHOLDER_ADDRESS_RE.test(l.address.trim())) return "lot-only placeholder address"
  if (l.lotNumber && PLACEHOLDER_LOT_RE.test(l.lotNumber)) return "placeholder lot number"
  return null
}

const rows = await prisma.listing.findMany({
  where: {
    status: "for sale",
    currentPrice: { not: null },
  },
  select: {
    id: true,
    address: true,
    lotNumber: true,
    floorPlan: true,
    currentPrice: true,
    sourceUrl: true,
    community: {
      select: {
        name: true,
        city: true,
        lastScrapedAt: true,
        builder: { select: { name: true } },
        listings: {
          where: { status: { not: "removed" } },
          select: { address: true, lotNumber: true, status: true, currentPrice: true },
        },
      },
    },
  },
  orderBy: [{ community: { builder: { name: "asc" } } }, { community: { name: "asc" } }, { id: "asc" }],
})

const hidden = rows
  .map((listing) => ({ listing, reason: hiddenReason(listing) }))
  .filter((item) => item.reason)

const byBuilder = new Map()
for (const item of hidden) {
  const builder = item.listing.community.builder.name
  byBuilder.set(builder, (byBuilder.get(builder) ?? 0) + 1)
}

console.log(`AUDIT hidden priced active listings: ${hidden.length}`)
console.log(`AUDIT priced active listings checked: ${rows.length}`)
console.log(`AUDIT by builder: ${JSON.stringify(Object.fromEntries([...byBuilder.entries()].sort()), null, 2)}`)

for (const { listing: l, reason } of hidden.slice(0, 100)) {
  console.log([
    `ID=${l.id}`,
    `builder=${l.community.builder.name}`,
    `community=${l.community.name}`,
    `address=${l.address ?? ""}`,
    `lot=${l.lotNumber ?? ""}`,
    `price=${l.currentPrice ?? ""}`,
    `reason=${reason}`,
  ].join(" | "))
}

if (hidden.length > 100) {
  console.log(`AUDIT truncated: showing first 100 of ${hidden.length}`)
}

await prisma.$disconnect()
