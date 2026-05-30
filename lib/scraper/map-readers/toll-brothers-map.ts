/**
 * toll-brothers-map.ts
 *
 * Wrapper around scrapeTollApollo that returns a MapResult.
 * Uses the existing SVG site-plan scraper from toll-brothers.ts.
 */

import { scrapeTollApollo } from "../toll-brothers"
import type { MapResult, MapLot } from "./types"

const TOLL_CITIES = [
  "Rancho Mission Viejo",
  "San Juan Capistrano",
  "Rancho Santa Margarita",
  "Huntington Beach",
  "Newport Beach",
  "Laguna Niguel",
  "Laguna Beach",
  "Laguna Hills",
  "Mission Viejo",
  "Lake Forest",
  "San Clemente",
  "Aliso Viejo",
  "Montebello",
  "Yorba Linda",
  "Buena Park",
  "Fountain Valley",
  "Westminster",
  "Garden Grove",
  "Santa Ana",
  "Seal Beach",
  "Los Alamitos",
  "Villa Park",
  "Irvine",
  "Tustin",
  "Orange",
  "Anaheim",
  "Brea",
  "Placentia",
  "Fullerton",
  "Cypress",
  "Stanton",
  "La Habra",
]

function cityFromAddress(address: string): string | undefined {
  const normalized = address.replace(/\s+/g, " ").trim()
  const city = TOLL_CITIES.find((name) =>
    new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\s*,?\\s*CA\\b`, "i").test(normalized)
  )
  if (city) return city

  const match = normalized.match(/\b([A-Za-z][A-Za-z\s.-]+),\s*CA\b/)
  return match?.[1]?.replace(/\s+/g, " ").trim()
}

export async function readTollBrothersMap(
  url: string,
  communityName: string,
  options: { expectedTotal?: number; debugDir?: string } = {}
): Promise<MapResult> {
  const result = await scrapeTollApollo(url, {
    communityName,
    expectedTotal: options.expectedTotal,
    debugDir: options.debugDir,
  })
  const city = Object.values(result.lotAddresses)
    .map(cityFromAddress)
    .find((value): value is string => !!value)

  const lots: MapLot[] = result.lots.map((lot) => {
    const s = lot.status.toLowerCase()
    const isQMI =
      lot.lotNum in result.lotPrices || lot.lotNum in result.lotAddresses

    let status: "for sale" | "sold" | "future"
    if (isQMI) {
      status = "for sale"
    } else if (s === "sold" || s === "reserved" || s === "closed") {
      status = "sold"
    } else {
      status = "future"
    }

    const planName =
      lot.planName && lot.planName !== "no data" ? lot.planName : undefined
    const spec = planName
      ? result.planSpecs[planName] ??
        Object.entries(result.planSpecs).find(([k]) =>
          planName.startsWith(k)
        )?.[1]
      : undefined

    // Only QMI-specific price; no plan-level fallback (no price = future rule)
    const price = result.lotPrices[lot.lotNum]
    const streetAddr = result.lotAddresses[lot.lotNum]
    const address = streetAddr ?? `Home Site ${lot.lotNum}`

    return {
      lotNumber: lot.lotNum,
      status,
      price,
      address,
      floorPlan: planName,
      beds: spec?.beds,
      baths: spec?.baths,
      sqft: spec?.sqft,
      floors: spec?.floors,
      propertyType: spec?.propertyType,
    } satisfies MapLot
  })

  return {
    sold: result.sold,
    forSale: result.forSale,
    future: result.future,
    total: result.total,
    city,
    lots,
    soldOut: result.soldOut,
  }
}
