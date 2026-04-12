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

    return NextResponse.json(
      { cities, builders, communities },
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
