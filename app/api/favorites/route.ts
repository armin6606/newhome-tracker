import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

// GET /api/favorites — returns array of favorited listingIds for the current user
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json([], { status: 200 })

    const favorites = await prisma.userFavorite.findMany({
      where:  { userId: user.id },
      select: { listingId: true },
    })

    return NextResponse.json(favorites.map((f) => f.listingId))
  } catch (err) {
    console.error("[/api/favorites GET]", err)
    return NextResponse.json({ error: "Failed to load favorites." }, { status: 500 })
  }
}

// POST /api/favorites — add a favorite
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* missing/malformed body → empty */ }

    const raw = body.listingId
    const listingId = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
    if (!listingId || isNaN(listingId) || listingId <= 0) {
      return NextResponse.json({ error: "listingId must be a positive integer" }, { status: 400 })
    }

    await prisma.userFavorite.upsert({
      where:  { userId_listingId: { userId: user.id, listingId } },
      create: { userId: user.id, listingId },
      update: {},
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[/api/favorites POST]", err)
    return NextResponse.json({ error: "Failed to save favorite." }, { status: 500 })
  }
}

// DELETE /api/favorites — remove a favorite
export async function DELETE(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* missing/malformed body → empty */ }

    const raw = body.listingId
    const listingId = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
    if (!listingId || isNaN(listingId) || listingId <= 0) {
      return NextResponse.json({ error: "listingId must be a positive integer" }, { status: 400 })
    }

    await prisma.userFavorite.deleteMany({
      where: { userId: user.id, listingId },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[/api/favorites DELETE]", err)
    return NextResponse.json({ error: "Failed to remove favorite." }, { status: 500 })
  }
}
