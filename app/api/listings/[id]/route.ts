import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Guard: id must be a positive integer string (e.g. "42", not "abc" or "1.5")
    const numId = parseInt(id, 10)
    if (!id || isNaN(numId) || numId <= 0 || String(numId) !== id) {
      return NextResponse.json({ error: "Invalid listing id" }, { status: 400 })
    }

    const listing = await prisma.listing.findUnique({
      where: { id: numId },
      include: {
        community: { include: { builder: true } },
        priceHistory: { orderBy: { detectedAt: "asc" } },
      },
    })

    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json(
      {
        ...listing,
        pricePerSqft:
          listing.currentPrice && listing.sqft
            ? Math.round(listing.currentPrice / listing.sqft)
            : null,
      },
      {
        headers: {
          // Listing details are stable for a few minutes
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "Vary": "Accept-Encoding",
        },
      }
    )
  } catch (err) {
    console.error("[/api/listings/[id]] Unhandled error:", err)
    return NextResponse.json({ error: "Failed to load listing." }, { status: 500 })
  }
}
