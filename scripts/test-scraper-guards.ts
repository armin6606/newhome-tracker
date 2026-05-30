import assert from "node:assert/strict"
import { buildListings } from "../lib/scraper"
import { isRealListing, isVisibleCommunity } from "../lib/site-visibility"
import type { MapResult } from "../lib/scraper/map-readers/types"

const qmiResult: MapResult = {
  sold: 0,
  forSale: 2,
  future: 1,
  total: 3,
  lots: [
    { lotNumber: "101", status: "for sale", address: "123 Irvine", price: 1_000_000 },
    { lotNumber: "102", status: "for sale", address: "124 Irvine" },
    { lotNumber: "103", status: "sold", address: "125 Irvine", price: 950_000 },
  ],
}

const listings = buildListings(qmiResult, "Pulte Test", "https://example.com")
assert.equal(listings[0].status, "for sale")
assert.equal(listings[0].price, 1_000_000)
assert.equal(listings[1].status, "future", "no-price QMI must not become active inventory")
assert.equal(listings[1].price, undefined)
assert.equal(listings[2].status, "sold")

assert.equal(isRealListing({ address: "123 Irvine", lotNumber: "101" }), true)
assert.equal(isRealListing({ address: "future-1", lotNumber: "future-1" }), false)
assert.equal(isRealListing({ address: null, lotNumber: "avail-1" }), false)
assert.equal(isRealListing({ address: "Lot 43", lotNumber: "43" }), false)

assert.equal(
  isVisibleCommunity({
    builder: { name: "Pulte" },
    lastScrapedAt: new Date(),
    listings: [{ address: "123 Irvine", lotNumber: "101", status: "for sale", currentPrice: 1_000_000 }],
  }),
  true
)
assert.equal(
  isVisibleCommunity({
    builder: { name: "Unsupported Builder" },
    lastScrapedAt: new Date(),
    listings: [{ address: "123 Irvine", lotNumber: "101", status: "for sale", currentPrice: 1_000_000 }],
  }),
  false
)

console.log("scraper guard tests passed")
