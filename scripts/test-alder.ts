import { scrapeTollApollo } from "@/lib/scraper/toll-brothers"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Alder-Collection"

async function main() {
  console.log("Testing Alder Collection...")
  const result = await scrapeTollApollo(URL)
  console.log(`\nResults:`)
  console.log(`  Total lots: ${result.total}`)
  console.log(`  For Sale (QMI): ${result.forSale}`)
  console.log(`  Sold: ${result.sold}`)
  console.log(`  Future: ${result.future}`)
  console.log(`  Plans: ${[...new Set(result.lots.map(l => l.planName).filter(Boolean))].join(', ')}`)
  console.log(`  QMI addresses: ${JSON.stringify(result.lotAddresses)}`)
  console.log(`  QMI prices: ${JSON.stringify(result.lotPrices)}`)
}
main().catch(console.error)
