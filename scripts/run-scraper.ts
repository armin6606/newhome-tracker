import { runScraper } from "../lib/scraper/index"
import { prisma } from "../lib/db"

async function main() {
  try {
    await runScraper()
  } catch (err) {
    console.error("Scraper failed:", err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
