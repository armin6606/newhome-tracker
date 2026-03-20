/**
 * Scrapes incentive text from community pages and assigns to all active listings in that community.
 * Run with: node scripts/scrape-incentives.mjs
 */
import { chromium } from "playwright"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

/** Extract incentive text from page body (runs in Node.js, not browser context) */
function parseIncentives(bodyText) {
  const lines = bodyText.split("\n").map((l) => l.trim()).filter((l) => l.length > 4)

  // 1. Look for specific patterns line by line
  const offerLines = lines.filter((l) =>
    /(?:buydown|closing\s+cost\s+credit|rate\s+buy[- ]?down|flex\s+cash|design\s+credit|upgrade\s+credit|special\s+offer|limited[\s-]time|builder\s+incentive|\$[\d,]+\s+credit|slam.dunk|first[- ]year\s+rate|forward\s+commit|lock\s+&\s+shop|move[- ]in\s+ready\s+savings)/i.test(l) &&
    l.length < 250
  )

  if (offerLines.length) {
    // Try to pair a rate line with a buydown description line
    const rateIdx = lines.findIndex((l) => /^\d+\.\d+%/.test(l) && /ARM|rate/i.test(l))
    const buydownIdx = lines.findIndex((l) => /first[- ]year\s+rate|buydown/i.test(l))
    if (rateIdx !== -1 && buydownIdx !== -1 && Math.abs(rateIdx - buydownIdx) <= 2) {
      const rateNum = lines[rateIdx].match(/^[\d.]+%/)?.[0] || ""
      return `${rateNum} ${lines[buydownIdx]}`.trim()
    }
    return offerLines.slice(0, 2).join(" · ")
  }

  // 2. Wider regex on full body
  const patterns = [
    // Lennar ARM offer: "X.XX% 7/6 Adjustable rate mortgage..."
    /\d+\.\d+%[^\n]{0,20}\d\/\d\s+Adjustable[^\n.]{0,200}/i,
    /\d+\.\d+%[^\n]{0,40}first[- ]year[^\n]{0,80}/i,
    /first[- ]year\s+rate[^\n]{0,120}/i,
    /\d\/\d\s+(?:ARM|buydown)[^\n]{0,120}/i,
    /closing\s+cost\s+(?:credit|assistance)[^\n.]{0,120}/i,
    /rate\s+buy[- ]?down[^\n.]{0,120}/i,
    /flex\s+cash[^\n.]{0,120}/i,
    /slam[- ]dunk[^\n.]{0,120}/i,
    /\$[\d,]+\s+(?:credit|savings?|cash\s+back)[^\n.]{0,100}/i,
    /upgrade\s+(?:credit|package)[^\n.]{0,100}/i,
    /limited[- ]time\s+offer[^\n.]{0,120}/i,
    /special\s+offer[^\n.]{0,120}/i,
  ]
  for (const pat of patterns) {
    const m = bodyText.match(pat)
    if (m) return m[0].trim().replace(/\s+/g, " ").slice(0, 200)
  }
  return null
}

async function getPageBody(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 })
    await page.waitForTimeout(3500)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3))
    await page.waitForTimeout(1500)
    return await page.evaluate(() => document.body?.innerText || "")
  } catch (err) {
    console.log(`    ✗ ${err.message?.slice(0, 70)}`)
    return ""
  }
}

async function main() {
  const communities = await prisma.community.findMany({
    include: { builder: true, listings: { where: { status: "active" }, select: { id: true } } },
  })
  console.log(`Scraping incentives for ${communities.length} communities...\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  // Cache by URL so we don't re-scrape the same page twice
  const urlCache = {}
  let totalUpdated = 0

  for (const community of communities) {
    const activeIds = community.listings.map((l) => l.id)
    if (!activeIds.length) continue

    let url = community.url
    let incentivesUrl = null
    const builderLower = community.builder.name.toLowerCase()
    // Use builder-level promo pages — these show site-wide banners
    if (builderLower.includes("lennar")) {
      // Lennar OC: check the OC promo page first, fall back to community URL
      url = "https://www.lennar.com/new-homes/california/orange-county/promo/ochlen_dsv26_oc"
      incentivesUrl = "https://www.lennar.com/new-homes/california/orange-county/promo/ochlen_dsv26_oc"
    } else if (builderLower.includes("toll")) {
      url = "https://www.tollbrothers.com/luxury-homes/California"
    }

    console.log(`[${community.builder.name}] ${community.name} (${activeIds.length} listings)`)
    console.log(`  URL: ${url.slice(0, 90)}`)

    let bodyText = urlCache[url]
    if (bodyText === undefined) {
      bodyText = await getPageBody(page, url)
      urlCache[url] = bodyText
    } else {
      console.log(`  (cached)`)
    }

    const incentives = parseIncentives(bodyText)
    if (incentives) {
      console.log(`  ✓ ${incentives.slice(0, 110)}`)
      await prisma.listing.updateMany({ where: { id: { in: activeIds } }, data: { incentives, incentivesUrl } })
      totalUpdated += activeIds.length
    } else {
      console.log(`  – No incentive found`)
      await prisma.listing.updateMany({ where: { id: { in: activeIds } }, data: { incentives: null, incentivesUrl: null } })
    }
    console.log()
    await page.waitForTimeout(1500)
  }

  await browser.close()
  await prisma.$disconnect()
  console.log(`Done. Updated ${totalUpdated} listings across all communities.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
