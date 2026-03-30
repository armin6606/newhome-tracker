/**
 * TEST ONLY — runs scrapeTollApollo on the Elm Collection page.
 */
import { scrapeTollApollo } from "../lib/scraper/toll-brothers"

const ELM_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const result = await scrapeTollApollo(ELM_URL)
  console.log("\n=== Toll Apollo Result ===")
  console.log(`For Sale : ${result.forSale}`)
  console.log(`Sold     : ${result.sold}`)
  console.log(`Future   : ${result.future}`)
  console.log(`Total    : ${result.total}`)
  console.log("\nAll lots:")
  for (const lot of result.lots) {
    console.log(`  lot=${lot.lotNum.padEnd(4)} status="${lot.status}" plan="${lot.planName}"`)
  }
}

main().catch(console.error)
