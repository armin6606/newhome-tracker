/**
 * Pulte Group scraper — covers both Pulte and Del Webb brands.
 * Uses the REST mapmarkers API directly (no browser needed).
 */
import type { ScrapedListing } from "./toll-brothers"

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
  return markersToListings(markers, "https://www.pulte.com")
}

export async function scrapeDelWebbOC(): Promise<ScrapedListing[]> {
  console.log("Fetching Del Webb OC communities via API...")
  const markers = await fetchPulteMarkers("Del Webb", "www.delwebb.com")
  console.log(`Found ${markers.length} Del Webb OC communities`)
  return markersToListings(markers, "https://www.delwebb.com")
}
