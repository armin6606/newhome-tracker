import { chromium } from "playwright"

const URL = "https://www.taylormorrison.com/ca/southern-california/irvine/aurora-at-luna-park"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  // ── 1. Community overview from main page ─────────────────────────────────────
  const overview = await page.evaluate(`(function() {
    var text = document.body.innerText
    var priceMatch = text.match(/From\s*\n?\s*\$([0-9,]+)/)
    var availMatch = text.match(/View All Available Homes\s*\((\d+)\)/)
    var plansMatch = text.match(/Floor plans\s*\((\d+)\)/)
    return {
      price: priceMatch ? priceMatch[1] : '',
      availableHomes: availMatch ? availMatch[1] : '',
      floorPlans: plansMatch ? plansMatch[1] : '',
    }
  })()`)
  console.log("=== Community Overview ===")
  console.log(JSON.stringify(overview))

  // ── 2. Available homes page ───────────────────────────────────────────────────
  await page.goto(URL + '/available-homes', { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(3000)

  const pageText = await page.evaluate(`(function() {
    return document.body.innerText
  })()`) as string

  const lines = pageText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
  console.log("\n=== Available Homes page (first 150 lines) ===")
  lines.slice(0, 150).forEach((l: string, i: number) => console.log(i + ': ' + l))

  // ── 3. Floor plans page ───────────────────────────────────────────────────────
  await page.goto(URL + '/floor-plans', { waitUntil: "networkidle", timeout: 60000 })
  await page.waitForTimeout(2000)
  const plansText = await page.evaluate(`(function() {
    return document.body.innerText.split('\n').map(function(l) { return l.trim() }).filter(function(l) { return l.length > 0 }).slice(0, 80).join('\n')
  })()`) as string
  console.log("\n=== Floor Plans page ===")
  console.log(plansText)

  await browser.close()
}
main().catch(console.error)
