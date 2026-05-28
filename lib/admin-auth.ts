import { NextRequest, NextResponse } from "next/server"

export function getAdminToken(req: NextRequest): string {
  const headerToken = req.headers.get("x-admin-token") ?? ""
  if (headerToken) return headerToken
  return new URL(req.url).searchParams.get("token") ?? ""
}

export function verifyAdminToken(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN || process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "Admin approval token is not configured." },
      { status: 500 }
    )
  }

  if (getAdminToken(req) !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}
