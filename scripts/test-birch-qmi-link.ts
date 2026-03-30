import { chromium } from "playwright"

const URL = "https://www.tollbrothers.com/luxury-homes-for-sale/California/Toll-Brothers-at-Great-Park-Neighborhoods/Birch-Collection"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)

  // Find QMI tab link href
  const qmiLinks = await page.evaluate(() => {
    const links: string[] = []
    document.querySelectorAll('a').forEach(a => {
      const txt = a.innerText?.trim() || ''
      if (/quick.move.in|available.homes|move.in.ready/i.test(txt) || /Quick-Move-In/i.test(a.href)) {
        links.push(`text="${txt}" href="${a.href}"`)
      }
    })
    return links
  })
  console.log("QMI links found:")
  qmiLinks.forEach(l => console.log(" ", l))

  // Also look for any link containing Quick-Move-In in href
  const allQmiHrefs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="Quick-Move-In"]'))
      .map(a => (a as HTMLAnchorElement).href)
      .filter((v, i, arr) => arr.indexOf(v) === i)
  })
  console.log("\nAll hrefs with Quick-Move-In:")
  allQmiHrefs.forEach(h => console.log(" ", h))

  await browser.close()
}
main().catch(console.error)
