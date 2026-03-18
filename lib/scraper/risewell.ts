/**
 * Risewell Homes scraper (formerly Landsea Homes / NWHM).
 * Uses the proxied Algolia API with OC masterplan filter.
 */
import type { ScrapedListing } from "./toll-brothers"

const BASE_URL = "https://risewellhomes.com"
// Base64 of: {"index":"wp_posts_neighborhoods","query":"Orange County","options":{"filters":"masterplan.id = 49004"}}
const OC_QUERY_B64 = "eyJpbmRleCI6IndwX3Bvc3RzX25laWdoYm9yaG9vZHMiLCJxdWVyeSI6Ik9yYW5nZSBDb3VudHkiLCJvcHRpb25zIjp7ImZpbHRlcnMiOiJtYXN0ZXJwbGFuLmlkID0gNDkwMDQifX0="

interface RisewellHit {
  name?: string
  status?: string
  isFutureCommunity?: boolean
  homeTypes?: string[]
  url?: string
  permalink?: string
  city?: string
  state?: string
  minPrice?: number
  maxPrice?: number
  priceLabel?: string
  minBedrooms?: number
  maxBedrooms?: number
  minBathrooms?: number
  maxBathrooms?: number
  minSqFt?: number
  maxSqFt?: number
  minSqft?: number
  maxSqft?: number
}

function parseTextPrice(text: string): number | undefined {
  // Handle "Low $1 million", "High $900s", "Mid $800,000s"
  const mDollarNum = text.match(/\$\s*([\d,]+)/)
  if (mDollarNum) {
    const n = parseInt(mDollarNum[1].replace(/,/g, ""), 10)
    if (!isNaN(n) && n > 10000) return n
    if (!isNaN(n)) return n * 1000 // e.g. "$1" from "$1 million" → 1000
  }
  const mMillion = text.match(/\$([\d.]+)\s*million/i)
  if (mMillion) return Math.round(parseFloat(mMillion[1]) * 1_000_000)
  return undefined
}

export async function scrapeRisewellOC(): Promise<ScrapedListing[]> {
  console.log("Fetching Risewell Homes OC communities via API...")
  const allListings: ScrapedListing[] = []

  try {
    const apiUrl = `${BASE_URL}/api/algolia/search?query=${OC_QUERY_B64}`
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": `${BASE_URL}/southern-california/orange-county-new-homes`,
      },
    })

    if (!res.ok) {
      console.log(`  Risewell API returned ${res.status}`)
      return []
    }

    const data = await res.json()
    const hits: RisewellHit[] = data?.hits || data?.results || []
    console.log(`Found ${hits.length} Risewell OC communities`)

    for (const hit of hits) {
      if (!hit.name) continue
      if (hit.isFutureCommunity) continue

      const relUrl = hit.url || hit.permalink || ""
      const communityUrl = relUrl.startsWith("http") ? relUrl : `${BASE_URL}${relUrl}`

      const price = hit.minPrice || parseTextPrice(hit.priceLabel || "")
      const sqft = hit.minSqFt || hit.minSqft
      const propertyType = /townhome|townhouse|attached|condo/i.test((hit.homeTypes || []).join(" "))
        ? "Attached"
        : "Detached"

      allListings.push({
        communityName: hit.name,
        communityUrl,
        address: `${hit.name} - Plans Available`,
        sqft,
        beds: hit.minBedrooms,
        baths: hit.minBathrooms,
        price: price && price > 100000 ? price : undefined,
        pricePerSqft: price && sqft && price > 100000 ? Math.round(price / sqft) : undefined,
        propertyType,
        sourceUrl: communityUrl,
      })
    }
  } catch (err) {
    console.error("Risewell API error:", err)
  }

  return allListings
}
