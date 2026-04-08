import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name  = searchParams.get("name")  || ""
  const state = searchParams.get("state") || "CA"

  const fallbackUrl = `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(name)}&state=${state}`

  // 1. Check DB cache first
  const cached = await prisma.schoolRating.findUnique({ where: { name } })
  if (cached) {
    return NextResponse.json({
      rating: cached.rating ?? null,
      url: cached.gsUrl || fallbackUrl,
    }, { headers: { "Cache-Control": "public, max-age=86400" } })
  }

  // 2. Try GreatSchools API (if key configured)
  const apiKey = process.env.GREATSCHOOLS_API_KEY
  if (apiKey) {
    try {
      const res = await fetch(
        `https://api.greatschools.org/schools/search?key=${apiKey}&q=${encodeURIComponent(name)}&state=${state}&limit=1`,
        { next: { revalidate: 86400 } }
      )
      if (res.ok) {
        const data = await res.json()
        const school = data?.schools?.[0]
        if (school) {
          const gsUrl = school.links?.profile
            ? `https://www.greatschools.org${school.links.profile}`
            : fallbackUrl
          // Cache in DB
          await prisma.schoolRating.upsert({
            where: { name },
            create: { name, state, rating: school.gsRating ?? null, gsUrl },
            update: { rating: school.gsRating ?? null, gsUrl, cachedAt: new Date() },
          })
          return NextResponse.json({ rating: school.gsRating ?? null, url: gsUrl })
        }
      }
    } catch { /* fall through */ }
  }

  // 3. No rating found — return fallback link only
  return NextResponse.json({ rating: null, url: fallbackUrl })
}
