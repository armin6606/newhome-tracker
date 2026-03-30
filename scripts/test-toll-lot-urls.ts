/**
 * Checks what URL/link data is available for each lot in the Toll Brothers SVG site plan.
 */
import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // Scroll to site plan
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]') || document.querySelector('[id="siteplan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(2000)

  // Check what attributes lot polygons have
  const lotData = await page.evaluate(() => {
    const results: Array<Record<string, string>> = []
    const shapes = Array.from(document.querySelectorAll('polygon[data-lot_num], path[data-lot_num], rect[data-lot_num]'))
    for (const s of shapes.slice(0, 5)) {
      const attrs: Record<string, string> = {}
      for (const attr of Array.from(s.attributes)) {
        attrs[attr.name] = attr.value
      }
      // Also check parent <a> tag
      const parent = s.parentElement
      if (parent?.tagName === 'A') attrs['parent_href'] = (parent as HTMLAnchorElement).href
      // Check parent <g> for onclick or data
      const grandParent = parent?.parentElement
      if (grandParent) {
        for (const attr of Array.from(grandParent.attributes)) {
          attrs['g_' + attr.name] = attr.value
        }
      }
      results.push(attrs)
    }
    return results
  })

  console.log("Sample lot attributes:")
  lotData.forEach((d, i) => {
    console.log(`\nLot ${i + 1}:`)
    Object.entries(d).forEach(([k, v]) => console.log(`  ${k} = "${v}"`))
  })

  // Check if clicking a lot navigates somewhere
  console.log("\n\nChecking for lot URLs via click handlers...")
  const clickableInfo = await page.evaluate(() => {
    const shapes = Array.from(document.querySelectorAll('g[id^="LOTS-"] polygon, g[id^="LOTS-"] path'))
    const info: string[] = []
    for (const s of shapes.slice(0, 3)) {
      const el = s as HTMLElement
      const lotNum = el.dataset['lot_num']
      const onclickAttr = el.getAttribute('onclick') || el.closest('a')?.getAttribute('href') || ''
      info.push(`Lot ${lotNum}: onclick="${onclickAttr}", closest-a-href="${el.closest('a')?.getAttribute('href') || 'none'}"`)
    }
    return info
  })
  clickableInfo.forEach(i => console.log(i))

  await browser.close()
}

main().catch(console.error)
