import { NextResponse } from "next/server"

const WORKFLOW_ID = "247086225"
const REPO        = "armin6606/newhome-tracker"

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, error: "GITHUB_DISPATCH_TOKEN not set" }, { status: 500 })
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ ok: false, status: res.status, error: text }, { status: 500 })
  }

  return NextResponse.json({ ok: true, triggered: new Date().toISOString() })
}
