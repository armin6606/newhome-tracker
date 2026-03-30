/**
 * run-scraper.ts
 *
 * Entry point for the 1 AM daily scrape.
 * Delegates entirely to lib/scraper/index.ts → runScraper().
 *
 * Run manually:  npx tsx scripts/run-scraper.ts
 * GitHub Actions cron: daily at 1 AM PST (9 AM UTC)
 */

import { runScraper } from "../lib/scraper/index"
import { prisma } from "../lib/db"

runScraper()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
