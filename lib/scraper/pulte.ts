/**
 * Pulte Group scraper — covers both Pulte and Del Webb brands.
 * Uses the REST mapmarkers API directly (no browser needed).
 */
import type { ScrapedListing } from "./toll-brothers"

const PULTE_PROMOS_URLS = [
  "https://www.pulte.com/promotions",
  "https://www.pulte.com/special-offers",
  "https://www.pulte.com/offers",
]

const DELWEBB_PROMOS_URLS = [
  "https://www.delwebb.com/promotions",
  "https://www.delwebb.com/special-offers",
  "https://www.delwebb.com/offers",
]

/** Fetch and parse a builder promotions page for offer text (HTML fetch, no browser needed) */
async function fetchBuilderPromotions(promoUrls: string[]): Promise<string | undefined> {
  for (const promoUrl of promoUrls) {
    try {
      console.log(`  Trying promotions page: ${promoUrl}`)
      const res = await fetch(promoUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
        },
        redirect: "follow",
      })
      if (!res.ok) continue

      const html = await res.text()

      // Extract text content from HTML (strip tags)
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()

      if (textContent.length < 100) continue

      const parts: string[] = []
      const seen = new Set<string>()

      // Look for offer patterns in the text
      const patterns = [
        /(?:save|get|receive|up\s+to)\s+\$[\d,]+[^.!]{0,150}/gi,
        /\$[\d,]+\s+(?:toward|in|off|credit|closing|savings)[^.!]{0,150}/gi,
        /\d+(?:\.\d+)?%\s+(?:interest|rate|APR|fixed|down)[^.!]{0,150}/gi,
        /(?:closing\s+cost|rate\s+buy[-\s]?down|flex\s+cash|design\s+credit|upgrade\s+credit|move-in\s+incentive)[^.!]{0,200}/gi,
        /(?:limited[-\s]time|special\s+offer|exclusive\s+offer|don'?t\s+miss)[^.!]{0,200}/gi,
        /(?:reduced\s+rate|no\s+(?:monthly\s+)?mortgage\s+insurance|low\s+(?:down|rate))[^.!]{0,200}/gi,
      ]

      for (const pat of patterns) {
        let m: RegExpExecArray | null
        while ((m = pat.exec(textContent)) !== null) {
          const txt = m[0].trim()
          if (txt.length > 15 && txt.length < 300 && !seen.has(txt)) {
            seen.add(txt)
            parts.push(txt)
          }
          if (parts.length >= 5) break
        }
      }

      if (parts.length > 0) return parts.slice(0, 5).join(" | ")
    } catch {
      continue
    }
  }
  return undefined
}

interface PulteMarker {
  Id?: number
  Name?: string
  Address?: { Street1?: string; City?: string; State?: string; ZipCode?: string }
  MinBedrooms?: number
  MinBathrooms?: number
  MinGarage?: number
  StartingFromPrice?: number
  CommunityLink?: string
  IsCommunitySoldOut?: boolean
  Incentive?: string
  IncentiveMessage?: string
  PromotionText?: string
  SpecialOffer?: string
  HasIncentive?: boolean
  IncentiveTitle?: string
  IncentiveDescription?: string
}

async function fetchPulteMarkers(brand: string, brandHost: string): Promise<PulteMarker[]> {
  const url = `https://${brandHost}/api/marker/mapmarkers?brand=${encodeURIComponent(brand)}&state=California&region=Orange%20County&qmi=false`
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  })
  if (!res.ok) {
    console.log(`  ${brand} API returned ${res.status}`)
    return []
  }
  return res.json()
}

function extractIncentiveFromMarker(m: PulteMarker): string | undefined {
  // Check all possible incentive fields from the API response
  const candidates = [
    m.Incentive,
    m.IncentiveMessage,
    m.IncentiveTitle,
    m.IncentiveDescription,
    m.PromotionText,
    m.SpecialOffer,
  ].filter(Boolean) as string[]

  if (candidates.length > 0) {
    return candidates.join(" | ").trim()
  }
  return undefined
}

function markersToListings(markers: PulteMarker[], websiteBase: string): ScrapedListing[] {
  const listings: ScrapedListing[] = []
  for (const m of markers) {
    if (!m.Name || m.IsCommunitySoldOut) continue
    const communityPath = m.CommunityLink || ""
    const communityUrl = communityPath.startsWith("http") ? communityPath : `${websiteBase}${communityPath}`
    const price = m.StartingFromPrice && m.StartingFromPrice > 100000 ? Math.round(m.StartingFromPrice) : undefined
    const address = m.Address?.Street1
      ? `${m.Address.Street1}, ${m.Address.City || ""}, CA`.trim()
      : `${m.Name} - Plans Available`

    const incentives = extractIncentiveFromMarker(m)

    listings.push({
      communityName: m.Name,
      communityUrl,
      address,
      beds: m.MinBedrooms,
      baths: m.MinBathrooms,
      garages: m.MinGarage,
      price,
      propertyType: "Detached",
      incentives,
      sourceUrl: communityUrl,
    })
  }
  return listings
}

export async function scrapePulteOC(): Promise<ScrapedListing[]> {
  console.log("Fetching Pulte OC communities via API...")
  const markers = await fetchPulteMarkers("Pulte", "www.pulte.com")
  console.log(`Found ${markers.length} Pulte OC communities`)
  const listings = markersToListings(markers, "https://www.pulte.com")

  // If no listings have incentives from API, scrape the builder-wide promotions page
  const hasApiIncentives = listings.some((l) => l.incentives)
  if (!hasApiIncentives) {
    console.log("  No incentives from API, checking Pulte promotions page...")
    const builderPromo = await fetchBuilderPromotions(PULTE_PROMOS_URLS)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
      for (const l of listings) {
        if (!l.incentives) l.incentives = builderPromo
      }
    }
  }

  return listings
}

export async function scrapeDelWebbOC(): Promise<ScrapedListing[]> {
  console.log("Fetching Del Webb OC communities via API...")
  const markers = await fetchPulteMarkers("Del Webb", "www.delwebb.com")
  console.log(`Found ${markers.length} Del Webb OC communities`)
  const listings = markersToListings(markers, "https://www.delwebb.com")

  // If no listings have incentives from API, scrape the builder-wide promotions page
  const hasApiIncentives = listings.some((l) => l.incentives)
  if (!hasApiIncentives) {
    console.log("  No incentives from API, checking Del Webb promotions page...")
    const builderPromo = await fetchBuilderPromotions(DELWEBB_PROMOS_URLS)
    if (builderPromo) {
      console.log(`  Builder-wide promo found: ${builderPromo.substring(0, 100)}...`)
      for (const l of listings) {
        if (!l.incentives) l.incentives = builderPromo
      }
    }
  }

  return listings
}
