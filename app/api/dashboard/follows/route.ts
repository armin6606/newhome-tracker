import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const follows = await prisma.communityFollow.findMany({
    where: { userId: user.id },
    include: {
      community: {
        include: {
          builder: true,
          listings: {
            where: { status: "active" },
            select: { id: true, currentPrice: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const communities = follows.map(({ community: c }) => {
    const activeListings = c.listings
    const prices = activeListings.map((l) => l.currentPrice).filter(Boolean) as number[]
    const minPrice = prices.length ? Math.min(...prices) : null
    const maxPrice = prices.length ? Math.max(...prices) : null

    return {
      id: c.id,
      name: c.name,
      builder: c.builder.name,
      city: c.city,
      activeCount: activeListings.length,
      minPrice,
      maxPrice,
      url: c.url,
    }
  })

  return NextResponse.json(communities)
}
