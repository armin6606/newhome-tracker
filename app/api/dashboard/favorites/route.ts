import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: user.id },
    include: {
      listing: {
        include: {
          community: { include: { builder: true } },
          priceHistory: { orderBy: { detectedAt: "asc" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const listings = favorites.map(({ listing: l }) => {
    const daysListed = Math.floor((Date.now() - new Date(l.firstDetected).getTime()) / 86400000)

    return {
      id:           l.id,
      address:      l.address,
      community:    l.community.name,
      builder:      l.community.builder.name,
      floorPlan:    l.floorPlan,
      beds:         l.beds,
      baths:        l.baths,
      sqft:         l.sqft,
      currentPrice: l.currentPrice,
      pricePerSqft: (l.currentPrice && l.sqft) ? Math.round(l.currentPrice / l.sqft) : null,
      hoaFees:      l.hoaFees,
      taxes:        l.taxes,
      propertyType: l.propertyType,
      moveInDate:   l.moveInDate,
      status:       l.status,
      daysListed,
      sourceUrl:    l.sourceUrl,
      priceHistory: l.priceHistory,
    }
  })

  return NextResponse.json(listings)
}
