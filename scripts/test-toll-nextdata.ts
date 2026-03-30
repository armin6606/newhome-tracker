import { chromium } from "playwright"

const URLS = [
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection/Quick-Move-In/282842",
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection",
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  for (const url of URLS) {
    console.log(`\n=== ${url.split("/").slice(-2).join("/")} ===`)
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(2000)

    // Check __NEXT_DATA__ for HOA/tax fields
    const nextData = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__")
      if (!el) return null
      try {
        const data = JSON.parse(el.textContent || "")
        // Flatten to find keys mentioning hoa/tax
        const results: string[] = []
        const walk = (obj: unknown, path: string) => {
          if (!obj || typeof obj !== "object") return
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const newPath = `${path}.${k}`
            if (/hoa|tax|mello|assessment|fee|dues|monthlyFee/i.test(k)) {
              results.push(`${newPath} = ${JSON.stringify(v)?.substring(0, 80)}`)
            }
            if (typeof v === "object" && v !== null && results.length < 30) {
              walk(v, newPath)
            }
          }
        }
        walk(data, "")
        return results
      } catch { return null }
    })

    if (nextData && nextData.length > 0) {
      console.log("Found in __NEXT_DATA__:")
      nextData.forEach(r => console.log(" ", r))
    } else {
      console.log("Nothing HOA/tax in __NEXT_DATA__. Checking page body...")
      const bodyText = await page.evaluate(() => {
        return (document.body.innerText || "").substring(0, 5000)
      })
      const lines = bodyText.split("\n").filter(l =>
        /hoa|homeowner|mello|tax|assessment|monthly|fee|dues/i.test(l) && l.trim().length < 200
      )
      lines.forEach(l => console.log(" ", l.trim()))
    }
  }

  await browser.close()
}
main().catch(console.error)
