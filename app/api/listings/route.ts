import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

// Fields the frontend actually uses — keeps response payload lean
const LISTING_SELECT = {
  id:            true,
  address:       true,
  lotNumber:     true,
  floorPlan:     true,
  beds:          true,
  baths:         true,
  sqft:          true,
  floors:        true,
  garages:       true,
  propertyType:  true,
  currentPrice:  true,
  pricePerSqft:  true,
  moveInDate:    true,
  incentives:    true,
  incentivesUrl: true,
  status:        true,
  sourceUrl:     true,
  firstDetected: true,
  soldAt:        true,
  community: {
    select: { name: true, city: true, state: true, builder: { select: { name: true } } },
  },
} as const

const VALID_STATUSES  = new Set(["active", "sold", "future", "removed", "all"])
const VALID_SORT_FIELDS = ["currentPrice", "firstDetected", "sqft", "beds", "pricePerSqft", "floors"]
// firstDetected and beds are always non-null so Prisma rejects nulls:"last" for them
const NON_NULLABLE_SORT = new Set(["firstDetected", "beds"])

const MAX_PAGE_SIZE = 500

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    // ── Parse & validate params ──────────────────────────────────────────────

    const rawStatus = searchParams.get("status") || "active"
    if (!VALID_STATUSES.has(rawStatus)) {
      return NextResponse.json(
        { error: `Invalid status "${rawStatus}". Allowed: ${[...VALID_STATUSES].join(", ")}` },
        { status: 400 }
      )
    }
    const status = rawStatus

    // Numeric params — NaN guard: if the value is present but non-numeric, return 400
    function parseIntParam(name: string): number | undefined | "invalid" {
      const raw = searchParams.get(name)
      if (!raw) return undefined
      const n = parseInt(raw, 10)
      return isNaN(n) ? "invalid" : n
    }
    function parseFloatParam(name: string): number | undefined | "invalid" {
      const raw = searchParams.get(name)
      if (!raw) return undefined
      const n = parseFloat(raw)
      return isNaN(n) ? "invalid" : n
    }

    const minPrice    = parseIntParam("minPrice")
    const maxPrice    = parseIntParam("maxPrice")
    const minBeds     = parseFloatParam("minBeds")
    const minSqft     = parseIntParam("minSqft")
    const maxSqft     = parseIntParam("maxSqft")
    const floors      = parseIntParam("floors")
    const communityId = parseIntParam("communityId")
    const page        = parseIntParam("page")
    const limit       = parseIntParam("limit")

    for (const [name, val] of Object.entries({ minPrice, maxPrice, minBeds, minSqft, maxSqft, floors, communityId, page, limit })) {
      if (val === "invalid") {
        return NextResponse.json({ error: `Invalid numeric value for param "${name}"` }, { status: 400 })
      }
    }

    // communityId must be a positive integer if provided
    if (typeof communityId === "number" && communityId < 1) {
      return NextResponse.json({ error: `"communityId" must be a positive integer` }, { status: 400 })
    }

    // Pagination
    const pageSize = typeof limit === "number" ? Math.min(limit, MAX_PAGE_SIZE) : MAX_PAGE_SIZE
    const skip     = typeof page  === "number" && page > 1 ? (page - 1) * pageSize : 0

    // Sort
    const rawSortBy  = searchParams.get("sortBy") || "firstDetected"
    const rawSortDir = searchParams.get("sortDir")
    if (rawSortDir && rawSortDir !== "asc" && rawSortDir !== "desc") {
      return NextResponse.json(
        { error: `Invalid sortDir "${rawSortDir}". Allowed: asc, desc` },
        { status: 400 }
      )
    }
    const sortDir      = rawSortDir === "asc" ? "asc" : "desc"
    const orderByField = VALID_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "firstDetected"
    const orderByValue = NON_NULLABLE_SORT.has(orderByField)
      ? sortDir
      : { sort: sortDir, nulls: "last" as const }

    // ── Build where clause ───────────────────────────────────────────────────

    // Exclude placeholder lots (null address or avail-N / sold-N / future-N)
    const where: Record<string, unknown> = {
      address: { not: null },
      NOT: [
        { address: { startsWith: "avail-" } },
        { address: { startsWith: "sold-"  } },
        { address: { startsWith: "future-"} },
      ],
    }

    if (status !== "all") where.status = status

    if (typeof minPrice === "number" || typeof maxPrice === "number") {
      where.currentPrice = {
        ...(typeof minPrice === "number" ? { gte: minPrice } : {}),
        ...(typeof maxPrice === "number" ? { lte: maxPrice } : {}),
      }
    }
    if (typeof minBeds     === "number") where.beds   = { gte: minBeds }
    if (typeof minSqft     === "number" || typeof maxSqft === "number") {
      where.sqft = {
        ...(typeof minSqft === "number" ? { gte: minSqft } : {}),
        ...(typeof maxSqft === "number" ? { lte: maxSqft } : {}),
      }
    }
    if (typeof floors      === "number") where.floors      = floors
    if (typeof communityId === "number") where.communityId = communityId

    // ── Query ────────────────────────────────────────────────────────────────

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        select:  LISTING_SELECT,
        orderBy: { [orderByField]: orderByValue },
        take:    pageSize,
        skip,
      }),
      prisma.listing.count({ where }),
    ])

    const hasMore = skip + listings.length < total

    // pricePerSqft is already stored in DB — no need to recompute here
    return NextResponse.json(
      { listings, total, hasMore, page: page ?? 1, pageSize },
      {
        headers: {
          // 30-second CDN cache; stale responses served for up to 60 s while
          // revalidating. Prevents DB hammering on rapid filter changes.
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[/api/listings] Unhandled error:", err)
    return NextResponse.json(
      { error: "Failed to fetch listings. Please try again." },
      { status: 500 }
    )
  }
}
