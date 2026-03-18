import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name  = searchParams.get("name")  || ""
  const state = searchParams.get("state") || "CA"

  const fallbackUrl = `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(name)}&state=${state}`

  const apiKey = process.env.GREATSCHOOLS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ rating: null, url: fallbackUrl })
  }

  try {
    const res = await fetch(
      `https://api.greatschools.org/schools/search?key=${apiKey}&q=${encodeURIComponent(name)}&state=${state}&limit=1`,
      { next: { revalidate: 86400 } } // cache 24h
    )
    if (!res.ok) return NextResponse.json({ rating: null, url: fallbackUrl })

    const data = await res.json()
    const school = data?.schools?.[0]
    if (!school) return NextResponse.json({ rating: null, url: fallbackUrl })

    const gsUrl = school.links?.profile
      ? `https://www.greatschools.org${school.links.profile}`
      : fallbackUrl

    return NextResponse.json({
      rating: school.gsRating ?? null,
      name:   school.name,
      url:    gsUrl,
    })
  } catch {
    return NextResponse.json({ rating: null, url: fallbackUrl })
  }
}
