import { NextResponse } from "next/server"

// In-process cache (survives across requests in the same Vercel instance)
let cached: { rate: number; fetchedAt: number } | null = null
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

export async function GET() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json({ rate: cached.rate })
  }

  try {
    // Freddie Mac PMMS 30-year fixed via FRED (public, no API key required)
    const res = await fetch(
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US",
      { cache: "no-store" }
    )
    const text = await res.text()
    // CSV format: DATE,MORTGAGE30US\n2025-01-02,6.91\n...
    const lines = text.trim().split("\n").filter((l) => !l.startsWith("DATE") && l.trim())
    const lastLine = lines[lines.length - 1]
    const rate = parseFloat(lastLine.split(",")[1])

    if (!isNaN(rate) && rate > 0) {
      cached = { rate, fetchedAt: Date.now() }
      return NextResponse.json({ rate })
    }
  } catch (err) {
    console.error("Failed to fetch mortgage rate:", err)
  }

  // Fallback to last cached value or reasonable default
  const fallback = cached?.rate ?? 6.85
  return NextResponse.json({ rate: fallback, fallback: true })
}
