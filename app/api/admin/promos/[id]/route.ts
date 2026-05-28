import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyAdminToken } from "@/lib/admin-auth"

type Params = { params: Promise<{ id: string }> }

function cleanText(value: unknown, max = 4000): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, max) : undefined
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null) return null
  if (typeof value !== "string" || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function applyPromoToListings(promo: {
  builderName: string | null
  communityName: string | null
  offerText: string
  offerUrl: string | null
}) {
  if (!promo.builderName) return 0

  const communities = await prisma.community.findMany({
    where: {
      builder: { name: { equals: promo.builderName, mode: "insensitive" } },
      ...(promo.communityName
        ? { name: { equals: promo.communityName, mode: "insensitive" } }
        : {}),
    },
    select: { id: true },
  })

  if (communities.length === 0) return 0

  const result = await prisma.listing.updateMany({
    where: {
      communityId: { in: communities.map((community) => community.id) },
      status: "for sale",
    },
    data: {
      incentives: promo.offerText,
      incentivesUrl: promo.offerUrl,
    },
  })

  return result.count
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const authError = verifyAdminToken(req)
  if (authError) return authError

  const { id } = await params
  const promoId = Number(id)
  if (!Number.isInteger(promoId)) {
    return NextResponse.json({ error: "Invalid promo id" }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const action = cleanText((body as Record<string, unknown>).action, 20)
  if (action !== "approve" && action !== "reject" && action !== "update") {
    return NextResponse.json({ error: "action must be approve, reject, or update" }, { status: 400 })
  }

  const existing = await prisma.promoSubmission.findUnique({ where: { id: promoId } })
  if (!existing) return NextResponse.json({ error: "Promo not found" }, { status: 404 })

  const data = {
    builderName: cleanText((body as Record<string, unknown>).builderName, 150) ?? existing.builderName,
    communityName: cleanText((body as Record<string, unknown>).communityName, 150) ?? existing.communityName,
    offerText: cleanText((body as Record<string, unknown>).offerText) ?? existing.offerText,
    offerUrl: cleanText((body as Record<string, unknown>).offerUrl, 1000) ?? existing.offerUrl,
    expiresAt: parseDate((body as Record<string, unknown>).expiresAt) ?? existing.expiresAt,
    notes: cleanText((body as Record<string, unknown>).notes, 1000) ?? existing.notes,
  }

  if (action === "update") {
    const promo = await prisma.promoSubmission.update({
      where: { id: promoId },
      data,
    })
    return NextResponse.json({ ok: true, promo })
  }

  if (action === "reject") {
    const promo = await prisma.promoSubmission.update({
      where: { id: promoId },
      data: {
        ...data,
        status: "rejected",
        reviewedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true, promo })
  }

  if (!data.builderName) {
    return NextResponse.json({ error: "builderName is required before approval" }, { status: 400 })
  }

  const affectedListings = await applyPromoToListings(data)
  const promo = await prisma.promoSubmission.update({
    where: { id: promoId },
    data: {
      ...data,
      status: "approved",
      affectedListings,
      reviewedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true, promo, affectedListings })
}
