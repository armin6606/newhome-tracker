import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { BUILDER_SHEET_TABS } from "@/lib/sheet-validator"

const MAX_PARAM_LEN = 100
const MAX_RESULTS   = 100

/**
 * Normalise incentive text for grouping:
 *  - Collapse whitespace
 *  - Lowercase + strip non-alphanumeric noise → dedup key only
 *  - Keep a clean (whitespace-collapsed, trimmed) version for display
 */
function normalizeOffer(text: string): { display: string; key: string } {
  const display = text.replace(/\s+/g, " ").trim()
  const key     = display.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
  return { display, key }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const builderParam = searchParams.get("builder") || ""
    const cityParam    = searchParams.get("city")    || ""

    // Guard against absurdly long filter strings
    if (builderParam.length > MAX_PARAM_LEN || cityParam.length > MAX_PARAM_LEN) {
      return NextResponse.json(
        { error: `Filter params must be ${MAX_PARAM_LEN} characters or fewer` },
        { status: 400 }
      )
    }

    const communities = await prisma.community.findMany({
      where: {
        listings: { some: { status: "active", incentives: { not: null } } },
        ...(cityParam    ? { city:    { contains: cityParam,    mode: "insensitive" } } : {}),
        ...(builderParam ? { builder: { name: { contains: builderParam, mode: "insensitive" } } } : {}),
      },
      select: {
        id:      true,
        name:    true,
        city:    true,
        state:   true,
        url:     true,
        builder: { select: { name: true } },
        listings: {
          where:   { status: "active", incentives: { not: null } },
          select:  { incentives: true, currentPrice: true },
          orderBy: { currentPrice: "asc" },
        },
      },
      orderBy: { name: "asc" },
      take: MAX_RESULTS + 1,  // fetch one extra to detect truncation
    })

    const hasMore    = communities.length > MAX_RESULTS
    const truncated  = hasMore ? communities.slice(0, MAX_RESULTS) : communities

    // ── Sheet guardrail: only return communities from known builders ──────────
    const allowed = truncated.filter((c) => !!BUILDER_SHEET_TABS[c.builder.name])

    // ── Group by (builder + normalised incentive text) ───────────────────────
    // Unlike the old logic (which only keyed on the FIRST listing's incentive),
    // we now group by each DISTINCT incentive text within a community so no
    // offer is silently dropped when listings have different incentive strings.
    const offerMap = new Map<string, {
      offerText:   string
      builder:     string
      communities: {
        id:          number
        name:        string
        city:        string
        state:       string
        url:         string | null
        activeCount: number
        minPrice:    number | null
        maxPrice:    number | null
      }[]
    }>()

    for (const c of allowed) {
      // Collect distinct incentive texts in this community
      const distinctOffers = [...new Set(
        c.listings.map((l) => l.incentives).filter(Boolean) as string[]
      )]

      const prices   = c.listings
        .map((l) => l.currentPrice)
        .filter((p): p is number => p !== null)

      const communityEntry = {
        id:          c.id,
        name:        c.name,
        city:        c.city    ?? "",
        state:       c.state   ?? "",
        url:         c.url     ?? null,
        activeCount: c.listings.length,
        // Use reduce instead of spread to avoid call-stack overflow on large arrays
        minPrice: prices.length ? prices.reduce((m, p) => (p < m ? p : m), prices[0]) : null,
        maxPrice: prices.length ? prices.reduce((m, p) => (p > m ? p : m), prices[0]) : null,
      }

      for (const rawOffer of distinctOffers) {
        const { display, key } = normalizeOffer(rawOffer)
        const mapKey           = `${c.builder.name}::${key}`

        if (offerMap.has(mapKey)) {
          offerMap.get(mapKey)!.communities.push(communityEntry)
        } else {
          offerMap.set(mapKey, {
            offerText:   display,   // store the cleaned display version, not raw
            builder:     c.builder.name,
            communities: [communityEntry],
          })
        }
      }
    }

    const grouped = Array.from(offerMap.values()).sort((a, b) => {
      // Sort by number of communities carrying the offer (broadest first),
      // then alphabetically by builder name
      if (b.communities.length !== a.communities.length)
        return b.communities.length - a.communities.length
      return a.builder.localeCompare(b.builder)
    })

    return NextResponse.json(
      { ok: true, count: grouped.length, hasMore, grouped },
      {
        headers: {
          // Incentives change at most weekly — 2-min cache is safe and cuts DB load
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[/api/incentives] Unhandled error:", err)
    return NextResponse.json(
      { error: "Failed to fetch incentives. Please try again." },
      { status: 500 }
    )
  }
}
