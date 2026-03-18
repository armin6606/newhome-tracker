import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSheetLookup, resolveSheetRow } from "@/lib/sheets"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const [listing, sheetLookup] = await Promise.all([
    prisma.listing.findUnique({
      where: { id: parseInt(id) },
      include: {
        community: { include: { builder: true } },
        priceHistory: { orderBy: { detectedAt: "asc" } },
      },
    }),
    getSheetLookup(),
  ])

  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const sheet = resolveSheetRow(sheetLookup, listing.community.name, listing.floorPlan)
  if (!sheet) return NextResponse.json(listing)

  return NextResponse.json({
    ...listing,
    propertyType: sheet.propertyType || listing.propertyType,
    hoaFees: sheet.hoa ?? listing.hoaFees,
    taxes: (sheet.taxRate && listing.currentPrice)
      ? Math.round(listing.currentPrice * sheet.taxRate / 100)
      : sheet.annualTax ?? listing.taxes,
  })
}
