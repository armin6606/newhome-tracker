import { runScraper } from "../lib/scraper/index"

runScraper().then((stats) => {
  console.log("\nFinal stats:", stats)
  process.exit(0)
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
