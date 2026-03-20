import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const EXCLUDED_BUILDERS = ["Bonanni Development", "City Ventures"]

export async function GET() {
  // Only return cities, builders, and communities that have active listings
  const activeCommunities = await prisma.community.findMany({
    where: {
      builder: { name: { notIn: EXCLUDED_BUILDERS } },
      listings: { some: { status: "active" } },
    },
    select: {
      name: true,
      city: true,
      builder: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  })

  const cities      = [...new Set(activeCommunities.map((c) => c.city))].sort()
  const builders    = [...new Set(activeCommunities.map((c) => c.builder.name))].sort()
  const communities = activeCommunities.map((c) => c.name)

  return NextResponse.json({ cities, builders, communities })
}
