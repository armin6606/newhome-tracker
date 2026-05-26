/**
 * Merge duplicate communities that are clearly the same source.
 *
 * This script only merges communities with the same builder and same normalized
 * URL. It keeps the most trustworthy row: scraped rows first, then higher
 * listing count, then older id.
 *
 * Run:
 *   npx tsx scripts/merge-duplicate-communities.mjs --dry-run
 *   npx tsx scripts/merge-duplicate-communities.mjs
 */

import { createRequire } from "module"
import { existsSync, readFileSync } from "fs"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const DRY_RUN = process.argv.includes("--dry-run")

const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.replace(/\r/, "").split("=")
    if (k && !k.startsWith("#") && v.length) {
      process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "")
    }
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

function normalizeUrl(raw) {
  if (!raw) return ""
  try {
    const url = new URL(raw)
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|gbraid|gad_|fbclid)/i.test(key)) url.searchParams.delete(key)
    }
    url.pathname = url.pathname.replace(/\/+$/, "").toLowerCase()
    return `${url.hostname.toLowerCase()}${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`
  } catch {
    return raw.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "")
  }
}

function chooseCanonical(rows) {
  return [...rows].sort((a, b) => {
    const aScraped = a.lastScrapedAt ? 1 : 0
    const bScraped = b.lastScrapedAt ? 1 : 0
    if (aScraped !== bScraped) return bScraped - aScraped

    const aTime = a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0
    const bTime = b.lastScrapedAt ? new Date(b.lastScrapedAt).getTime() : 0
    if (aTime !== bTime) return bTime - aTime

    if (a._count.listings !== b._count.listings) return b._count.listings - a._count.listings
    return a.id - b.id
  })[0]
}

function preferred(current, incoming) {
  return current ?? incoming ?? null
}

async function mergeListing(source, targetCommunityId, targetListings) {
  const byAddress = source.address
    ? targetListings.find((l) => l.address?.toLowerCase() === source.address.toLowerCase())
    : null
  const byLot = source.lotNumber
    ? targetListings.find((l) => l.lotNumber === source.lotNumber)
    : null
  const duplicate = byAddress || byLot

  if (!duplicate) {
    if (!DRY_RUN) {
      await prisma.listing.update({
        where: { id: source.id },
        data: { communityId: targetCommunityId },
      })
    }
    targetListings.push({ ...source, communityId: targetCommunityId })
    return "moved"
  }

  const sourceUpdated = source.lastUpdated?.getTime?.() ?? 0
  const duplicateUpdated = duplicate.lastUpdated?.getTime?.() ?? 0
  const sourceIsBetter = sourceUpdated > duplicateUpdated

  const updates = sourceIsBetter
    ? {
        address: preferred(source.address, duplicate.address),
        lotNumber: preferred(source.lotNumber, duplicate.lotNumber),
        floorPlan: preferred(source.floorPlan, duplicate.floorPlan),
        sqft: preferred(source.sqft, duplicate.sqft),
        beds: preferred(source.beds, duplicate.beds),
        baths: preferred(source.baths, duplicate.baths),
        garages: preferred(source.garages, duplicate.garages),
        floors: preferred(source.floors, duplicate.floors),
        currentPrice: preferred(source.currentPrice, duplicate.currentPrice),
        pricePerSqft: preferred(source.pricePerSqft, duplicate.pricePerSqft),
        propertyType: preferred(source.propertyType, duplicate.propertyType),
        hoaFees: preferred(source.hoaFees, duplicate.hoaFees),
        taxes: preferred(source.taxes, duplicate.taxes),
        moveInDate: preferred(source.moveInDate, duplicate.moveInDate),
        schools: preferred(source.schools, duplicate.schools),
        incentives: preferred(source.incentives, duplicate.incentives),
        incentivesUrl: preferred(source.incentivesUrl, duplicate.incentivesUrl),
        status: source.status ?? duplicate.status,
        sourceUrl: preferred(source.sourceUrl, duplicate.sourceUrl),
        soldAt: preferred(source.soldAt, duplicate.soldAt),
      }
    : {}

  if (!DRY_RUN) {
    if (Object.keys(updates).length > 0) {
      await prisma.listing.update({ where: { id: duplicate.id }, data: updates })
    }

    await prisma.priceHistory.updateMany({
      where: { listingId: source.id },
      data: { listingId: duplicate.id },
    })

    const favorites = await prisma.userFavorite.findMany({ where: { listingId: source.id } })
    for (const favorite of favorites) {
      const exists = await prisma.userFavorite.findUnique({
        where: { userId_listingId: { userId: favorite.userId, listingId: duplicate.id } },
      })
      if (exists) {
        await prisma.userFavorite.delete({ where: { id: favorite.id } })
      } else {
        await prisma.userFavorite.update({
          where: { id: favorite.id },
          data: { listingId: duplicate.id },
        })
      }
    }

    await prisma.listing.delete({ where: { id: source.id } })
  }

  return "deduped"
}

async function mergeCommunity(source, target) {
  const sourceListings = await prisma.listing.findMany({ where: { communityId: source.id } })
  const targetListings = await prisma.listing.findMany({ where: { communityId: target.id } })

  let moved = 0
  let deduped = 0
  for (const listing of sourceListings) {
    const result = await mergeListing(listing, target.id, targetListings)
    if (result === "moved") moved++
    if (result === "deduped") deduped++
  }

  const follows = await prisma.communityFollow.findMany({ where: { communityId: source.id } })
  let followsMoved = 0
  let followsDeduped = 0
  if (!DRY_RUN) {
    for (const follow of follows) {
      const exists = await prisma.communityFollow.findUnique({
        where: { userId_communityId: { userId: follow.userId, communityId: target.id } },
      })
      if (exists) {
        await prisma.communityFollow.delete({ where: { id: follow.id } })
        followsDeduped++
      } else {
        await prisma.communityFollow.update({
          where: { id: follow.id },
          data: { communityId: target.id },
        })
        followsMoved++
      }
    }

    await prisma.community.update({
      where: { id: target.id },
      data: {
        city: target.city || source.city,
        state: target.state || source.state,
        url: target.url || source.url,
        lastScrapedAt: target.lastScrapedAt ?? source.lastScrapedAt,
      },
    })
    await prisma.community.delete({ where: { id: source.id } })
  }

  return { moved, deduped, followsMoved, followsDeduped }
}

async function main() {
  if (DRY_RUN) console.log("DRY RUN: no database changes will be made.\n")

  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { id: true, name: true } },
      _count: { select: { listings: true } },
    },
    orderBy: [{ builderId: "asc" }, { name: "asc" }],
  })

  const groups = new Map()
  for (const community of communities) {
    const normalizedUrl = normalizeUrl(community.url)
    if (!normalizedUrl) continue
    const key = `${community.builderId}::${normalizedUrl}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(community)
  }

  const duplicateGroups = [...groups.values()].filter((rows) => rows.length > 1)
  if (duplicateGroups.length === 0) {
    console.log("No duplicate communities found by builder + URL.")
    return
  }

  console.log(`Found ${duplicateGroups.length} duplicate community group(s).\n`)

  for (const rows of duplicateGroups) {
    const target = chooseCanonical(rows)
    const sources = rows.filter((row) => row.id !== target.id)
    console.log(`${target.builder.name}: ${rows.map((r) => `${r.name}#${r.id}`).join(" / ")}`)
    console.log(`  Keep: ${target.name}#${target.id} (${target._count.listings} listings, lastScrapedAt=${target.lastScrapedAt?.toISOString?.() ?? "null"})`)

    for (const source of sources) {
      console.log(`  Merge: ${source.name}#${source.id} -> ${target.name}#${target.id}`)
      const stats = await mergeCommunity(source, target)
      console.log(`    listings moved=${stats.moved}, deduped=${stats.deduped}, follows moved=${stats.followsMoved}, follows deduped=${stats.followsDeduped}`)
    }
    console.log("")
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
