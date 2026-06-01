export const CITY_COUNTY: Record<string, string> = {
  "aliso viejo": "Orange County",
  anaheim: "Orange County",
  brea: "Orange County",
  "chino hills": "San Bernardino County",
  "french valley": "Riverside County",
  fullerton: "Orange County",
  "garden grove": "Orange County",
  "hacienda heights": "Los Angeles County",
  "huntington beach": "Orange County",
  irvine: "Orange County",
  "laguna niguel": "Orange County",
  "lake forest": "Orange County",
  "long beach": "Los Angeles County",
  "los angeles": "Los Angeles County",
  menifee: "Riverside County",
  "mission viejo": "Orange County",
  "moreno valley": "Riverside County",
  murrieta: "Riverside County",
  "newport beach": "Orange County",
  orange: "Orange County",
  "orange county": "Orange County",
  perris: "Riverside County",
  "rancho mission viejo": "Orange County",
  riverside: "Riverside County",
  "san bernardino": "San Bernardino County",
  "santa clarita": "Los Angeles County",
  "santa paula": "Ventura County",
  temecula: "Riverside County",
  torrance: "Los Angeles County",
  tustin: "Orange County",
  "ventura county": "Ventura County",
  wildomar: "Riverside County",
  winchester: "Riverside County",
  "yorba linda": "Orange County",
}

export function getCountyForCity(city: string | null | undefined): string | null {
  if (!city) return null
  return CITY_COUNTY[city.toLowerCase().trim()] ?? null
}

export function getCitiesForCounty(county: string): string[] {
  const target = county.toLowerCase().trim()
  return Object.entries(CITY_COUNTY)
    .filter(([, mappedCounty]) => mappedCounty.toLowerCase() === target)
    .map(([city]) => city.replace(/\b\w/g, (c) => c.toUpperCase()))
}
