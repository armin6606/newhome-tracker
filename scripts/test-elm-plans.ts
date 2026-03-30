/**
 * Probe the Elm Collection page for floor plan specs (beds/baths/sqft per plan).
 */
import { chromium } from "playwright"

const URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })

  // Try clicking "Floor Plans" tab
  for (const text of ["Floor Plans", "Floorplans", "Plans"]) {
    const tab = page.locator(`a:has-text("${text}"), button:has-text("${text}")`)
    if (await tab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await tab.first().click()
      await page.waitForTimeout(2000)
      console.log(`Clicked tab: ${text}`)
      break
    }
  }

  // Dump all plan card text
  const planCards = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll(
        '[class*="FloorPlan"], [class*="floorPlan"], [class*="PlanCard"], [class*="planCard"], [class*="HomeDesign"], [class*="homeDesign"]'
      )
    )
    return cards.map((c) => ({
      text: (c as HTMLElement).innerText?.trim().slice(0, 300),
      classes: c.className,
    }))
  })

  console.log(`\nFound ${planCards.length} plan cards:`)
  planCards.forEach((c, i) => {
    console.log(`\n--- Card ${i + 1} [${c.classes.slice(0, 60)}] ---`)
    console.log(c.text)
  })

  // Also try a broader scrape of anything mentioning beds/sqft
  const specBlocks = await page.evaluate(() => {
    const results: string[] = []
    document.querySelectorAll('[class*="spec"], [class*="Spec"], [class*="detail"], [class*="Detail"]').forEach((el) => {
      const txt = (el as HTMLElement).innerText?.trim()
      if (txt && (txt.includes("Bed") || txt.includes("Sq") || txt.includes("Bath")) && txt.length < 400) {
        results.push(txt)
      }
    })
    return [...new Set(results)]
  })
  console.log("\n\nSpec blocks:")
  specBlocks.forEach((b) => console.log("---\n" + b))

  await browser.close()
}

main().catch(console.error)
