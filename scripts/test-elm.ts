/**
 * TEST ONLY — not saved to DB.
 * Scrapes the Toll Brothers Elm Collection and prints results as a table.
 */
import { chromium } from "playwright"
import { randomUserAgent } from "../lib/scraper/utils"
import { scrapeCommunityPage } from "../lib/scraper/toll-brothers"

const ELM_URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: randomUserAgent() })
  const page = await context.newPage()

  try {
    console.log("Scraping Elm Collection (test only — no DB write)...\n")
    const listings = await scrapeCommunityPage(page, "Elm Collection", ELM_URL)

    if (!listings.length) {
      console.log("No listings found.")
      return
    }

    // Print table header
    const header = [
      "Address".padEnd(30),
      "Plan".padEnd(20),
      "Beds".padEnd(5),
      "Baths".padEnd(6),
      "Sqft".padEnd(7),
      "Price".padEnd(12),
      "$/sqft".padEnd(8),
      "Lot".padEnd(8),
      "Move-In".padEnd(15),
      "HOA".padEnd(7),
      "Taxes".padEnd(7),
    ].join(" | ")

    const sep = "-".repeat(header.length)
    console.log(header)
    console.log(sep)

    for (const l of listings) {
      const row = [
        (l.address || "").padEnd(30),
        (l.floorPlan || "").padEnd(20),
        String(l.beds ?? "").padEnd(5),
        String(l.baths ?? "").padEnd(6),
        String(l.sqft ?? "").padEnd(7),
        (l.price ? `$${l.price.toLocaleString()}` : "").padEnd(12),
        (l.pricePerSqft ? `$${l.pricePerSqft}` : "").padEnd(8),
        (l.lotNumber || "").padEnd(8),
        (l.moveInDate || "").padEnd(15),
        (l.hoaFees ? `$${l.hoaFees}` : "").padEnd(7),
        (l.taxes ? `$${l.taxes}` : "").padEnd(7),
      ].join(" | ")
      console.log(row)
    }

    console.log(sep)
    console.log(`\nTotal: ${listings.length} listings`)
  } finally {
    await browser.close()
  }
}

main().catch(console.error)
