import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

// GET /api/favorites — returns array of favorited listingIds for the current user
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([], { status: 200 })

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: user.id },
    select: { listingId: true },
  })

  return NextResponse.json(favorites.map((f) => f.listingId))
}

// POST /api/favorites — add a favorite
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { listingId } = await request.json()
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 })

  await prisma.userFavorite.upsert({
    where: { userId_listingId: { userId: user.id, listingId } },
    create: { userId: user.id, listingId },
    update: {},
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/favorites — remove a favorite
export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { listingId } = await request.json()
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 })

  await prisma.userFavorite.deleteMany({
    where: { userId: user.id, listingId },
  })

  return NextResponse.json({ ok: true })
}
