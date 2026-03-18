import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"
import { getSheetLookup, resolveSheetRow } from "@/lib/sheets"

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

  const sheetLookup = await getSheetLookup()

  const listings = favorites.map(({ listing: l }) => {
    const sheet = resolveSheetRow(sheetLookup, l.community.name, l.floorPlan)
    const hoaFees = sheet?.hoa ?? l.hoaFees
    const taxes = sheet?.annualTax ?? l.taxes
    const propertyType = sheet?.propertyType ?? l.propertyType

    const firstDetectedMs = new Date(l.firstDetected).getTime()
    const daysListed = Math.floor((Date.now() - firstDetectedMs) / 86400000)

    return {
      id: l.id,
      address: l.address,
      community: l.community.name,
      builder: l.community.builder.name,
      floorPlan: l.floorPlan,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      currentPrice: l.currentPrice,
      pricePerSqft: l.pricePerSqft,
      hoaFees,
      taxes,
      propertyType,
      moveInDate: l.moveInDate,
      status: l.status,
      daysListed,
      sourceUrl: l.sourceUrl,
      priceHistory: l.priceHistory,
    }
  })

  return NextResponse.json(listings)
}
