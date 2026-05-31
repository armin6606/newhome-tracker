import assert from "node:assert/strict"
import { buildListings } from "../lib/scraper"
import { isRealListing, isVisibleCommunity } from "../lib/site-visibility"
import { normalizeListingLotKey, normalizeLotLabel, normalizeLotNumber } from "../lib/lot-number"
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

assert.equal(normalizeLotNumber("16"), "16")
assert.equal(normalizeLotNumber("Lot 16"), "16")
assert.equal(normalizeLotNumber("Home Site 16"), "16")
assert.equal(normalizeLotNumber("homesite 16"), "16")
assert.equal(normalizeLotNumber("HS16"), "16")
assert.equal(normalizeLotNumber("HS 016"), "16")
assert.equal(normalizeLotNumber("avail 01"), "avail-1")
assert.equal(normalizeLotLabel("Home Site 16"), "16")
assert.equal(normalizeLotLabel("123 Irvine"), null)
assert.equal(normalizeListingLotKey(null, "Lot 16"), "16")

const placeholderAddressResult: MapResult = {
  sold: 0,
  forSale: 1,
  future: 0,
  total: 1,
  lots: [
    { lotNumber: "104", status: "for sale", address: "Home Site 104", price: 1_100_000 },
  ],
}
const placeholderAddressListings = buildListings(placeholderAddressResult, "Toll Test", "https://example.com")
assert.equal(
  placeholderAddressListings[0].status,
  "future",
  "priced listings with placeholder addresses must not become visible active inventory"
)
assert.equal(placeholderAddressListings[0].price, undefined)

const hsAddressListings = buildListings({
  sold: 0,
  forSale: 1,
  future: 0,
  total: 1,
  lots: [
    { lotNumber: "43", status: "for sale", address: "HS43", price: 1_200_000 },
  ],
}, "Toll Test", "https://example.com")
assert.equal(hsAddressListings[0].status, "future")
assert.equal(hsAddressListings[0].price, undefined)

assert.equal(isRealListing({ address: "123 Irvine", lotNumber: "101" }), true)
assert.equal(isRealListing({ address: "future-1", lotNumber: "future-1" }), false)
assert.equal(isRealListing({ address: null, lotNumber: "avail-1" }), false)
assert.equal(isRealListing({ address: "Lot 43", lotNumber: "43" }), false)
assert.equal(isRealListing({ address: "Home Site 43", lotNumber: "43" }), false)
assert.equal(isRealListing({ address: "HS43", lotNumber: "43" }), false)

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
