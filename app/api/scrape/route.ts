import { NextResponse } from "next/server"
import { runScraper } from "@/lib/scraper/index"

// Simple secret to prevent accidental triggers
const SCRAPE_SECRET = process.env.SCRAPE_SECRET || "dev-scrape"

export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({}))
  if (secret !== SCRAPE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const stats = await runScraper()
    return NextResponse.json({ success: true, stats })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
