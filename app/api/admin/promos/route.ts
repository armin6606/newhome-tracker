import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyAdminToken } from "@/lib/admin-auth"

const MAX_TEXT_LEN = 4000

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, max) : undefined
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminToken(req)
  if (authError) return authError

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "pending"

  const promos = await prisma.promoSubmission.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return NextResponse.json({ ok: true, promos })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminToken(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const offerText = cleanText((body as Record<string, unknown>).offerText, MAX_TEXT_LEN)
  if (!offerText) {
    return NextResponse.json({ error: "offerText is required" }, { status: 400 })
  }

  const sourceMessageId = cleanText((body as Record<string, unknown>).sourceMessageId, 300)

  if (sourceMessageId) {
    const existing = await prisma.promoSubmission.findFirst({ where: { sourceMessageId } })
    if (existing) return NextResponse.json({ ok: true, promo: existing, duplicate: true })
  }

  const promo = await prisma.promoSubmission.create({
    data: {
      source: cleanText((body as Record<string, unknown>).source, 80) ?? "email",
      sourceMessageId,
      sourceFrom: cleanText((body as Record<string, unknown>).sourceFrom, 300),
      sourceSubject: cleanText((body as Record<string, unknown>).sourceSubject, 500),
      sourceDate: parseDate((body as Record<string, unknown>).sourceDate),
      rawSnippet: cleanText((body as Record<string, unknown>).rawSnippet, 1000),
      builderName: cleanText((body as Record<string, unknown>).builderName, 150),
      communityName: cleanText((body as Record<string, unknown>).communityName, 150),
      offerText,
      offerUrl: cleanText((body as Record<string, unknown>).offerUrl, 1000),
      expiresAt: parseDate((body as Record<string, unknown>).expiresAt),
      confidence: typeof (body as Record<string, unknown>).confidence === "number"
        ? (body as Record<string, number>).confidence
        : undefined,
      notes: cleanText((body as Record<string, unknown>).notes, 1000),
    },
  })

  return NextResponse.json({ ok: true, promo })
}
