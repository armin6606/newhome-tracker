import { chromium } from "playwright"

const URL =
  "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Elm-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  })

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.evaluate(() => {
    const el = document.querySelector('[class*="CommunitySitePlan"]')
    if (el) el.scrollIntoView()
  })
  await page.waitForTimeout(3000)

  await page.waitForFunction(() => {
    const svgs = document.querySelectorAll('svg')
    for (const svg of Array.from(svgs)) {
      if (svg.getAttribute('iterated') === 'true') return true
    }
    return false
  }, { timeout: 15000 }).catch(() => {})

  // Search for "View Home Site List" text
  const legendHtml = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    for (const el of all) {
      const txt = (el as HTMLElement).innerText || ''
      if (txt.includes('View Home Site List') && txt.length < 600) {
        return {
          text: txt.trim(),
          html: el.outerHTML.slice(0, 2000),
          classes: el.className?.toString(),
        }
      }
    }
    return null
  })

  console.log("=== 'View Home Site List' element ===")
  console.log(JSON.stringify(legendHtml, null, 2))

  // Also: read the SVG <defs> or <style> — plan colors are often defined there
  const svgStyles = await page.evaluate(() => {
    const results: string[] = []
    document.querySelectorAll('svg style, svg defs').forEach(el => {
      results.push(el.innerHTML?.slice(0, 3000))
    })
    return results
  })
  console.log("\n=== SVG styles/defs ===")
  svgStyles.forEach((s, i) => console.log(`[${i}]`, s.slice(0, 1000)))

  // Read CSS class → color for lot_style_ classes (Toll Brothers injects these per community)
  const lotStyleColors = await page.evaluate(() => {
    const map: Record<string, string> = {}
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from((sheet as CSSStyleSheet).cssRules || [])) {
          const text = rule.cssText || ''
          if (text.includes('lot_style_') || text.includes('collection_style_')) {
            map[text.slice(0, 60)] = text
          }
        }
      } catch { /* cross-origin sheet */ }
    }
    return map
  })
  console.log("\n=== lot_style_ CSS rules ===")
  Object.values(lotStyleColors).slice(0, 20).forEach(r => console.log(r.slice(0, 200)))

  await browser.close()
}

main().catch(console.error)
