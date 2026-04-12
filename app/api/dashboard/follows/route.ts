import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

const MAX_DASHBOARD_FOLLOWS = 200

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const follows = await prisma.communityFollow.findMany({
      where:   { userId: user.id },
      include: {
        community: {
          include: {
            builder:  true,
            listings: {
              where:  { status: "active" },
              select: { id: true, currentPrice: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take:    MAX_DASHBOARD_FOLLOWS,
    })

    const communities = follows.map(({ community: c }) => {
      const prices = c.listings
        .map((l) => l.currentPrice)
        .filter((p): p is number => p !== null)

      // Use reduce instead of spread — no call-stack risk on large price arrays
      const minPrice = prices.length
        ? prices.reduce((m, p) => (p < m ? p : m), prices[0])
        : null
      const maxPrice = prices.length
        ? prices.reduce((m, p) => (p > m ? p : m), prices[0])
        : null

      return {
        id:          c.id,
        name:        c.name,
        builder:     c.builder.name,
        city:        c.city,
        activeCount: c.listings.length,
        minPrice,
        maxPrice,
        url:         c.url,
      }
    })

    return NextResponse.json(communities)
  } catch (err) {
    console.error("[/api/dashboard/follows]", err)
    return NextResponse.json({ error: "Failed to load followed communities." }, { status: 500 })
  }
}
