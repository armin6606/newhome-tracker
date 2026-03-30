/**
 * toll-brothers-map.ts
 *
 * Wrapper around scrapeTollApollo that returns a MapResult.
 * Uses the existing SVG site-plan scraper from toll-brothers.ts.
 */

import { scrapeTollApollo } from "../toll-brothers"
import type { MapResult, MapLot } from "./types"

export async function readTollBrothersMap(
  url: string,
  _communityName: string
): Promise<MapResult> {
  const result = await scrapeTollApollo(url)

  const lots: MapLot[] = result.lots.map((lot) => {
    const s = lot.status.toLowerCase()
    const isQMI =
      lot.lotNum in result.lotPrices || lot.lotNum in result.lotAddresses

    let status: "active" | "sold" | "future"
    if (isQMI) {
      status = "active"
    } else if (s === "sold" || s === "reserved") {
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
    const address = streetAddr ?? `Lot ${lot.lotNum}`

    return {
      lotNumber: lot.lotNum,
      status,
      price,
      address,
      floorPlan: planName,
      beds: spec?.beds,
      baths: spec?.baths,
      sqft: spec?.sqft,
    } satisfies MapLot
  })

  return {
    sold: result.sold,
    forSale: result.forSale,
    future: result.future,
    total: result.total,
    lots,
  }
}
