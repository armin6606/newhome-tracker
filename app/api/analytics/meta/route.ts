import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET() {
  try {
    const activeCommunities = await prisma.community.findMany({
      where: {
        listings: { some: { status: "active" } },
      },
      select: {
        name: true,
        city: true,
        builder: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    })

    // Filter out null cities before deduplicating
    const cities      = [...new Set(activeCommunities.map((c) => c.city).filter((c): c is string => !!c))].sort()
    const builders    = [...new Set(activeCommunities.map((c) => c.builder.name))].sort()
    const communities = activeCommunities.map((c) => c.name)

    // Derive counties from city list using SoCal city→county map
    const CITY_COUNTY: Record<string, string> = {
      "irvine": "Orange County", "orange": "Orange County", "anaheim": "Orange County",
      "tustin": "Orange County", "fullerton": "Orange County", "garden grove": "Orange County",
      "huntington beach": "Orange County", "newport beach": "Orange County", "lake forest": "Orange County",
      "mission viejo": "Orange County", "aliso viejo": "Orange County", "laguna niguel": "Orange County",
      "rancho mission viejo": "Orange County", "yorba linda": "Orange County", "brea": "Orange County",
      "long beach": "Los Angeles County", "los angeles": "Los Angeles County", "torrance": "Los Angeles County",
      "hacienda heights": "Los Angeles County", "chino hills": "San Bernardino County",
      "french valley": "Riverside County", "murrieta": "Riverside County", "temecula": "Riverside County",
      "menifee": "Riverside County", "riverside": "Riverside County", "moreno valley": "Riverside County",
      "perris": "Riverside County", "winchester": "Riverside County", "wildomar": "Riverside County",
    }
    const counties = [...new Set(
      cities.map((c) => CITY_COUNTY[c.toLowerCase().trim()]).filter(Boolean) as string[]
    )].sort()

    return NextResponse.json(
      { cities, builders, communities, counties },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[/api/analytics/meta] Unhandled error:", err)
    return NextResponse.json(
      { error: "Failed to load filter options." },
      { status: 500 }
    )
  }
}
