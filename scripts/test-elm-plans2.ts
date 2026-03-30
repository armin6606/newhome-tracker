import { chromium } from "playwright"

const URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  // Try clicking "Floor Plans" tab
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a, button')).filter(el =>
      /floor\s*plan/i.test((el as HTMLElement).innerText || '')
    ).map(el => ({ text: (el as HTMLElement).innerText?.trim(), tag: el.tagName }))
  )
  console.log("Floor plan tabs:", tabs)

  for (const text of ["Floor Plans", "Floorplans", "Homes", "Available Homes"]) {
    const tab = page.locator(`a:has-text("${text}"), button:has-text("${text}")`)
    if (await tab.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await tab.first().click()
      await page.waitForTimeout(2000)
      console.log(`Clicked: ${text}`)
      break
    }
  }

  // Dump everything that contains plan names (Vinca, Poppi, Sorrel) with their parent context
  const planData = await page.evaluate(() => {
    const planNames = ["Vinca", "Poppi", "Sorrel"]
    const results: Array<{ plan: string; context: string; classes: string }> = []
    const seen = new Set<Element>()

    for (const name of planNames) {
      document.querySelectorAll('*').forEach(el => {
        if ((el as HTMLElement).childElementCount > 3) return
        const txt = (el as HTMLElement).innerText?.trim() || ''
        if (txt === name || txt.startsWith(name)) {
          // Walk up to find a block with specs
          let parent = el.parentElement
          for (let i = 0; i < 6; i++) {
            if (!parent) break
            const pText = (parent as HTMLElement).innerText?.trim() || ''
            if ((pText.includes('Bedroom') || pText.includes('Square')) && pText.length < 600) {
              if (!seen.has(parent)) {
                seen.add(parent)
                results.push({ plan: txt, context: pText, classes: parent.className })
              }
              break
            }
            parent = parent.parentElement
          }
        }
      })
    }
    return results
  })

  console.log(`\nPlan data blocks (${planData.length}):`)
  planData.forEach((d, i) => {
    console.log(`\n[${i+1}] Plan: "${d.plan}" | Class: ${d.classes.slice(0,80)}`)
    console.log(d.context)
  })

  await browser.close()
}

main().catch(console.error)
