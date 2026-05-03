/**
 * test-delwebb.ts — quick test of the fixed Del Webb map reader
 */
import { readDelWebbMap } from "../lib/scraper/map-readers/del-webb-map"

async function main() {
  console.log("Testing Del Webb Luna map reader...")
  const result = await readDelWebbMap(
    "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498",
    "Luna"
  )
  console.log("\n=== Result ===")
  console.log(`Total: ${result.total}`)
  console.log(`Sold:  ${result.sold}`)
  console.log(`ForSale: ${result.forSale}`)
  console.log(`Future:  ${result.future}`)
  if (result.lots?.length) {
    const active = result.lots.filter(l => l.status === "active")
    const sold   = result.lots.filter(l => l.status === "sold")
    const future = result.lots.filter(l => l.status === "future")
    console.log(`\nActive lots (${active.length}):`)
    active.forEach(l => console.log(`  Lot ${l.lotNumber} | ${l.address} | price: ${l.price ?? 'none'}`))
    console.log(`\nSold lots (${sold.length}):`)
    sold.slice(0, 3).forEach(l => console.log(`  Lot ${l.lotNumber} | ${l.address}`))
    console.log(`\nFuture lots (${future.length}) — first 3:`)
    future.slice(0, 3).forEach(l => console.log(`  Lot ${l.lotNumber} | ${l.address}`))
  }
}

main().catch(console.error)
