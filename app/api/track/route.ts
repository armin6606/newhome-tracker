import { NextRequest, NextResponse } from "next/server"
import { recordSiteVisit } from "@/lib/site-traffic"

export const runtime = "nodejs"

type TrackPayload = {
  path?: unknown
  referrer?: unknown
  sessionId?: unknown
}

function trimString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({})) as TrackPayload
    const path = trimString(payload.path, 500)

    if (!path || !path.startsWith("/") || path.startsWith("/admin") || path.startsWith("/api")) {
      return NextResponse.json({ ok: true })
    }

    await recordSiteVisit({
      path,
      referrer: trimString(payload.referrer, 500),
      sessionId: trimString(payload.sessionId, 100),
      userAgent: trimString(req.headers.get("user-agent"), 500),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[/api/track] Failed to record visit:", err)
    return NextResponse.json({ ok: true })
  }
}
