import { createServerSupabaseClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

// GET /api/follows — returns array of followed communityIds for the current user
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([], { status: 200 })

  const follows = await prisma.communityFollow.findMany({
    where: { userId: user.id },
    select: { communityId: true },
  })

  return NextResponse.json(follows.map((f) => f.communityId))
}

// POST /api/follows — follow a community
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { communityId } = await request.json()
  if (!communityId) return NextResponse.json({ error: "communityId required" }, { status: 400 })

  await prisma.communityFollow.upsert({
    where: { userId_communityId: { userId: user.id, communityId } },
    create: { userId: user.id, communityId },
    update: {},
  })

  return NextResponse.json({ ok: true })
}

// DELETE /api/follows — unfollow a community
export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { communityId } = await request.json()
  if (!communityId) return NextResponse.json({ error: "communityId required" }, { status: 400 })

  await prisma.communityFollow.deleteMany({
    where: { userId: user.id, communityId },
  })

  return NextResponse.json({ ok: true })
}
