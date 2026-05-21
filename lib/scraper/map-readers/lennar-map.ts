/**
 * lennar-map.ts
 *
 * Wrapper around scrapeLennarCommunity that returns a MapResult.
 */

import { scrapeLennarCommunity } from "../lennar"
import type { LennarCache } from "../lennar"
import type { MapResult, MapLot } from "./types"

export async function readLennarMap(
  url: string,
  communityName: string,
  skipDetailUrls?: Set<string>,
  staticCache?: LennarCache
): Promise<MapResult> {
  const listings = await scrapeLennarCommunity(url, communityName, skipDetailUrls, staticCache)

  const lots: MapLot[] = listings.map((listing, i) => {
    let status: "for sale" | "sold" | "future"
    if (listing.status === "sold") {
      status = "sold"
    } else if (listing.status === "for sale") {
      // Trust Apollo "for sale" status — Lennar often omits price for active homes
      status = "for sale"
    } else {
      status = "future"
    }

    return {
      lotNumber: listing.lotNumber ?? `lot-${i + 1}`,
      status,
      price: listing.price,
      address: listing.address,
      floorPlan: listing.floorPlan,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
    } satisfies MapLot
  })

  const sold = lots.filter((l) => l.status === "sold").length
  const forSale = lots.filter((l) => l.status === "for sale").length
  const future = lots.filter((l) => l.status === "future").length
  const total = lots.length

  return { sold, forSale, future, total, lots }
}
