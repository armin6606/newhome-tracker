import { scrapeTollApollo } from "@/lib/scraper/toll-brothers"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  console.log("Testing Elm Collection with site plan filter fix...")
  const result = await scrapeTollApollo(URL)
  console.log(`\nResults:`)
  console.log(`  Total lots: ${result.total}`)
  console.log(`  For Sale: ${result.forSale}`)
  console.log(`  Sold: ${result.sold}`)
  console.log(`  Future: ${result.future}`)
  console.log(`  Unique plan names: ${[...new Set(result.lots.map(l => l.planName).filter(Boolean))].join(', ')}`)
}
main().catch(console.error)
