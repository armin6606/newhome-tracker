import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const MAX_NAME_LEN  = 200
const MAX_STATE_LEN = 2

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const rawName  = (searchParams.get("name")  ?? "").trim().slice(0, MAX_NAME_LEN)
    const rawState = (searchParams.get("state") ?? "CA").trim().toUpperCase().slice(0, MAX_STATE_LEN)

    // Require a non-empty school name — empty string is meaningless
    if (!rawName) {
      return NextResponse.json({ rating: null, url: null }, { status: 400 })
    }

    const fallbackUrl = `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(rawName)}&state=${encodeURIComponent(rawState)}`

    // 1. Check DB cache first
    const dbCached = await prisma.schoolRating.findUnique({ where: { name: rawName } })
    if (dbCached) {
      return NextResponse.json(
        { rating: dbCached.rating ?? null, url: dbCached.gsUrl || fallbackUrl },
        { headers: { "Cache-Control": "public, max-age=86400" } }
      )
    }

    // 2. Try GreatSchools API (if key configured)
    const apiKey = process.env.GREATSCHOOLS_API_KEY
    if (apiKey) {
      try {
        // Build URL separately so the API key never appears in error messages / logs
        const gsUrl = new URL("https://api.greatschools.org/schools/search")
        gsUrl.searchParams.set("key",   apiKey)
        gsUrl.searchParams.set("q",     rawName)
        gsUrl.searchParams.set("state", rawState)
        gsUrl.searchParams.set("limit", "1")

        const res = await fetch(gsUrl.toString(), {
          next:   { revalidate: 86400 },
          signal: AbortSignal.timeout(8_000),
        })

        if (res.ok) {
          const data = await res.json()
          const school = data?.schools?.[0]
          if (school) {
            const profileUrl = school.links?.profile
              ? `https://www.greatschools.org${school.links.profile}`
              : fallbackUrl

            // Cache in DB so we don't call the API on every page load
            await prisma.schoolRating.upsert({
              where:  { name: rawName },
              create: { name: rawName, state: rawState, rating: school.gsRating ?? null, gsUrl: profileUrl },
              update: { rating: school.gsRating ?? null, gsUrl: profileUrl, cachedAt: new Date() },
            })

            return NextResponse.json(
              { rating: school.gsRating ?? null, url: profileUrl },
              { headers: { "Cache-Control": "public, max-age=86400" } }
            )
          }
        }
      } catch (err) {
        console.error("[/api/schools] GreatSchools API error:", err)
        // fall through to fallback
      }
    }

    // 3. No rating found — return fallback link only
    return NextResponse.json(
      { rating: null, url: fallbackUrl },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    )
  } catch (err) {
    console.error("[/api/schools] Unhandled error:", err)
    return NextResponse.json({ error: "Failed to look up school." }, { status: 500 })
  }
}
