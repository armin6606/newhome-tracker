/**
 * Scrape HOA fees from Lennar community overview pages.
 * Visits each community URL and extracts HOA/monthly fee info.
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

// Community pages to check for HOA
const COMMUNITY_URLS = [
  { name: "Pineridge - Hazel",     url: "https://www.lennar.com/new-homes/california/orange-county/fullerton/pineridge/hazel" },
  { name: "Pineridge - Torrey",    url: "https://www.lennar.com/new-homes/california/orange-county/fullerton/pineridge/torrey" },
  { name: "Nova - Active Adult",   url: "https://www.lennar.com/new-homes/california/rancho-mission-viejo/rancho-mission-viejo/esencia/nova--active-adult" },
  { name: "Strata - Active Adult", url: "https://www.lennar.com/new-homes/california/rancho-mission-viejo/rancho-mission-viejo/esencia/strata--active-adult" },
  { name: "Cielo Vista",           url: "https://www.lennar.com/new-homes/california/orange-county/yorba-linda/cielo-vista" },
]

async function scrapeHoa(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(3000)

    return await page.evaluate(() => {
      // Look for HOA-related text anywhere on page
      const text = document.body.innerText

      // Common patterns: "$XXX/month", "$XXX per month", "HOA: $XXX"
      const patterns = [
        /HOA[^$\n]*\$\s*([\d,]+)/i,
        /association fee[^$\n]*\$\s*([\d,]+)/i,
        /monthly fee[^$\n]*\$\s*([\d,]+)/i,
        /\$\s*([\d,]+)\s*\/\s*mo(?:nth)?/i,
        /\$\s*([\d,]+)\s*per month/i,
      ]

      for (const pat of patterns) {
        const m = text.match(pat)
        if (m) {
          const val = parseInt(m[1].replace(/,/g, ""), 10)
          if (val > 0 && val < 5000) return val // sanity range
        }
      }

      // Also try div-pair extraction
      const kv = {}
      document.querySelectorAll("div, li").forEach(el => {
        const ch = el.children
        if (ch.length !== 2) return
        const k = ch[0].innerText?.trim()
        const v = ch[1].innerText?.trim()
        if (k && v && k.length < 80 && !k.includes("\n") && !kv[k]) kv[k] = v
      })
      const hoaRaw = kv["HOA fee"] || kv["HOA"] || kv["Association fee"] || kv["Monthly HOA"] || kv["Special assessment fee"]
      if (hoaRaw) {
        const m = hoaRaw.match(/\$?([\d,]+)/)
        if (m) return parseInt(m[1].replace(/,/g, ""), 10)
      }

      return null
    })
  } catch (err) {
    console.log(`  Error scraping ${url}: ${err.message?.slice(0, 60)}`)
    return null
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  for (const { name, url } of COMMUNITY_URLS) {
    console.log(`\nChecking ${name}...`)
    const hoa = await scrapeHoa(page, url)
    if (hoa) {
      const result = await prisma.listing.updateMany({
        where: {
          hoaFees: null,
          community: { name, builder: { name: "Lennar" } },
        },
        data: { hoaFees: hoa },
      })
      console.log(`  ✓ HOA=$${hoa}/mo → updated ${result.count} listings`)
    } else {
      console.log(`  ✗ HOA not found on page`)
    }
    await page.waitForTimeout(1000)
  }

  await browser.close()
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
