import type { MapLot, MapResult } from "./types"

const BASE_URL = "https://trumarkhomes.com"

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-")
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function parseMoney(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseInt(value.replace(/[^0-9]/g, ""), 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseFloat(value.replace(/,/g, ""))
  return Number.isFinite(n) ? n : undefined
}

function absoluteUrl(url: string, baseUrl: string): string {
  return new URL(decodeHtml(url), baseUrl).toString()
}

function matchText(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern)
  return match?.[1] ? stripTags(match[1]) : undefined
}

function cityFromUrl(url: string): string | undefined {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean)
    const stateIndex = parts.indexOf("ca")
    const citySlug = stateIndex >= 0 ? parts[stateIndex + 1] : undefined
    return citySlug
      ?.split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  } catch {
    return undefined
  }
}

function inferPropertyType(text: string): string | undefined {
  if (/townhome|townhouse/i.test(text)) return "Townhome"
  if (/condo|condominium/i.test(text)) return "Condo"
  if (/single[-\s]?family/i.test(text)) return "Single Family"
  return undefined
}

function inferFloors(text: string): number | undefined {
  const digit = text.match(/\b([2-4])\s*(?:story|stories|levels?)\b/i)
  if (digit) return parseInt(digit[1], 10)
  if (/\bthree\b.{0,40}\b(?:story|stories|levels?)\b/i.test(text)) return 3
  if (/\btwo\b.{0,40}\b(?:story|stories|levels?)\b/i.test(text)) return 2
  return undefined
}

function parseBaths(text: string | undefined): number | undefined {
  if (!text) return undefined
  const full = parseNumber(text)
  const halfMatch = text.match(/(\d+)\s*Half/i)
  const half = halfMatch ? parseInt(halfMatch[1], 10) * 0.5 : /half/i.test(text) ? 0.5 : 0
  return full == null ? undefined : full + half
}

function parsePlans(html: string): Map<string, Partial<MapLot>> {
  const plans = new Map<string, Partial<MapLot>>()
  const sectionStart = html.indexOf('<section id="plans"')
  if (sectionStart < 0) return plans

  const sectionEnd = html.indexOf("</section>", sectionStart)
  const section = html.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : undefined)
  const cards = section.match(/<div class="plan-slide">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? []

  for (const card of cards) {
    const floorPlan = matchText(card, /<div class="card-title">\s*([\s\S]*?)<\/div>/i)
    if (!floorPlan) continue
    plans.set(floorPlan.toLowerCase(), {
      floorPlan,
      price: parseMoney(matchText(card, /<span class="price">\s*([\s\S]*?)<\/span>/i)),
      sqft: parseNumber(matchText(card, /<span class="sqft">\s*([\s\S]*?)<\/span>/i)),
      beds: parseNumber(matchText(card, /<span class="bed">\s*([\s\S]*?)<\/span>/i)),
      baths: parseBaths(matchText(card, /<span class="bath">\s*([\s\S]*?)<\/span>/i)),
      garages: parseNumber(matchText(card, /<span class="garage">\s*([\s\S]*?)<\/span>/i)),
    })
  }

  return plans
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; NewKeyBot/1.0; +https://newkey.us)",
      accept: "text/html,application/xhtml+xml",
    },
  })
  if (!response.ok) throw new Error(`Trumark page failed: HTTP ${response.status}`)
  return response.text()
}

async function enrichFromDetail(lot: MapLot): Promise<MapLot> {
  if (!lot.sourceUrl) return lot
  try {
    const html = await fetchText(lot.sourceUrl)
    const overviewStart = html.indexOf('id="overview"')
    const detailText = stripTags(html.slice(Math.max(0, overviewStart), Math.max(overviewStart + 1, overviewStart + 12000)))
    return {
      ...lot,
      propertyType: inferPropertyType(detailText) ?? lot.propertyType,
      floors: inferFloors(detailText) ?? lot.floors,
    }
  } catch (err) {
    console.warn(`[Trumark] Detail enrichment failed for ${lot.address}: ${err instanceof Error ? err.message : err}`)
    return lot
  }
}

export async function readTrumarkMap(url: string, communityName: string): Promise<MapResult> {
  const html = await fetchText(url)
  const plans = parsePlans(html)
  const pageText = stripTags(html)
  const communityPropertyType = inferPropertyType(pageText)
  const communityFloors = inferFloors(pageText)

  const specsStart = html.indexOf('<section id="specs"')
  const plansStart = html.indexOf('<section id="plans"', specsStart)
  const specsSection = specsStart >= 0 ? html.slice(specsStart, plansStart > specsStart ? plansStart : undefined) : ""
  const cards = specsSection.match(/<article class="card spec-card[\s\S]*?<\/article>/g) ?? []
  const lots: MapLot[] = []

  for (const card of cards) {
    const href = card.match(/<a href="([^"]+)"[^>]*class="oi-aspect/i)?.[1]
    const sourceUrl = href ? absoluteUrl(href, url) : url
    const address = matchText(card, /<div class="card-title">\s*([\s\S]*?)<\/div>/i)
    const cityLine = matchText(card, /<span class="address-line">\s*([\s\S]*?)<\/span>/i)
    const floorPlan = matchText(card, /<div class="location-name[^"]*">\s*([^<]+?)(?:<|$)/i)
    const lotNumber = matchText(card, /<div class="divider">\s*Lot\s*#\s*([\s\S]*?)<\/div>/i)
    const price = parseMoney(matchText(card, /<div class="price[^"]*">\s*([\s\S]*?)<\/div>/i))
    const planDefaults = floorPlan ? plans.get(floorPlan.toLowerCase()) : undefined

    if (!address || !price) continue

    lots.push(await enrichFromDetail({
      lotNumber: lotNumber ?? address,
      status: "for sale",
      address,
      floorPlan: floorPlan ?? planDefaults?.floorPlan,
      price,
      sqft: parseNumber(matchText(card, /<span class="sqft">\s*([\s\S]*?)<\/span>/i)) ?? planDefaults?.sqft,
      beds: parseNumber(matchText(card, /<span class="bed">\s*([\s\S]*?)<\/span>/i)) ?? planDefaults?.beds,
      baths: parseBaths(matchText(card, /<span class="bath">\s*([\s\S]*?)<\/span>/i)) ?? planDefaults?.baths,
      garages: parseNumber(matchText(card, /<span class="garage">\s*([\s\S]*?)<\/span>/i)) ?? planDefaults?.garages,
      floors: communityFloors,
      propertyType: communityPropertyType,
      sourceUrl,
      moveInDate: matchText(card, /<div class="card-banner">\s*([\s\S]*?)<\/div>/i),
    }))

    if (cityLine && !cityFromUrl(url)) {
      console.log(`[Trumark] ${communityName}: ${cityLine}`)
    }
  }

  return {
    sold: 0,
    forSale: lots.length,
    future: 0,
    total: lots.length,
    lots,
    qmiOnly: true,
  }
}

export function trumarkCityFromUrl(url: string): string {
  return cityFromUrl(url) ?? "Orange County"
}
