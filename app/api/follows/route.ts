import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

// GET /api/follows — returns array of followed communityIds for the current user
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json([], { status: 200 })

    const follows = await prisma.communityFollow.findMany({
      where:  { userId: user.id },
      select: { communityId: true },
    })

    return NextResponse.json(follows.map((f) => f.communityId))
  } catch (err) {
    console.error("[/api/follows GET]", err)
    return NextResponse.json({ error: "Failed to load follows." }, { status: 500 })
  }
}

// POST /api/follows — follow a community
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* missing/malformed body → empty */ }

    const raw = body.communityId
    const communityId = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
    if (!communityId || isNaN(communityId) || communityId <= 0) {
      return NextResponse.json({ error: "communityId must be a positive integer" }, { status: 400 })
    }

    await prisma.communityFollow.upsert({
      where:  { userId_communityId: { userId: user.id, communityId } },
      create: { userId: user.id, communityId },
      update: {},
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[/api/follows POST]", err)
    return NextResponse.json({ error: "Failed to follow community." }, { status: 500 })
  }
}

// DELETE /api/follows — unfollow a community
export async function DELETE(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* missing/malformed body → empty */ }

    const raw = body.communityId
    const communityId = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
    if (!communityId || isNaN(communityId) || communityId <= 0) {
      return NextResponse.json({ error: "communityId must be a positive integer" }, { status: 400 })
    }

    await prisma.communityFollow.deleteMany({
      where: { userId: user.id, communityId },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[/api/follows DELETE]", err)
    return NextResponse.json({ error: "Failed to unfollow community." }, { status: 500 })
  }
}
