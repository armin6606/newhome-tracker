import { NextResponse } from "next/server"

// In-process cache (survives across requests on the same warm Vercel instance)
let cached: { rate: number; fetchedAt: number } | null = null
const CACHE_TTL      = 6 * 60 * 60 * 1000  // 6 hours in-memory TTL
const FETCH_TIMEOUT  = 10_000               // 10-second hard timeout on FRED requests
const FALLBACK_RATE  = 6.85                 // used only when FRED is unreachable AND no cache exists

export async function GET() {
  // Serve in-memory cache if still fresh
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json(
      { rate: cached.rate },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } }
    )
  }

  try {
    // Freddie Mac PMMS 30-year fixed via FRED (public, no API key required)
    const res = await fetch(
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US",
      {
        cache:  "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      }
    )

    if (res.ok) {
      const text = await res.text()
      // CSV format: DATE,MORTGAGE30US\n2025-01-02,6.91\n...
      // Strip \r so CRLF responses don't break the split
      const lines = text.replace(/\r/g, "").trim().split("\n")
        .filter((l) => !l.startsWith("DATE") && l.trim())
      const lastLine = lines[lines.length - 1]
      const rate = parseFloat(lastLine?.split(",")[1] ?? "")

      if (!isNaN(rate) && rate > 0 && rate < 30) {
        cached = { rate, fetchedAt: Date.now() }
        return NextResponse.json(
          { rate },
          { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600" } }
        )
      }
    }
  } catch (err) {
    console.error("[/api/mortgage-rate] FRED fetch failed:", err)
  }

  // Fallback — serve stale cache if available, otherwise use hardcoded default
  const fallback = cached?.rate ?? FALLBACK_RATE
  return NextResponse.json(
    { rate: fallback, fallback: true },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  )
}
