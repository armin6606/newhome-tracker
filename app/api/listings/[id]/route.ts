import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const listing = await prisma.listing.findUnique({
    where: { id: parseInt(id) },
    include: {
      community: { include: { builder: true } },
      priceHistory: { orderBy: { detectedAt: "asc" } },
    },
  })

  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    ...listing,
    pricePerSqft: (listing.currentPrice && listing.sqft) ? Math.round(listing.currentPrice / listing.sqft) : null,
  })
}
