/**
 * Shea Homes Orange County Scraper — diff-based
 *
 * 1. Read community list + URLs from Google Sheet Table 1 (Shea Communities tab).
 * 2. For each community, scrape the available-homes (QMI) page.
 * 3. Query DB for current active listings.
 * 4. Diff: new → ingest, sold → mark sold, price changed → update price.
 * 5. Sync Table 2 placeholder counts.
 * 6. Only POST to ingest if changes exist.
 *
 * Run: node scripts/scrape-shea.mjs
 * Schedule: Windows Task Scheduler via run-scraper.bat at 1:00 AM daily
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { fetchTable2Counts, reconcilePlaceholders } from "../../lib/sheet-table2.mjs"
import { sendWhatsApp, buildSummary } from "../../lib/notify.mjs"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, "../../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("../../node_modules/@prisma/client")
const prisma = new PrismaClient()

const SHEET_ID      = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEET_TAB     = "Shea Communities"
const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const BUILDER_NAME  = "Shea Homes"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

// ---------------------------------------------------------------------------
// Step 1: Read community list from Google Sheet Table 1
// ---------------------------------------------------------------------------
async function getCommunitiesFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`
  const res  = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status})`)
  const rows = parseCSV(await res.text())

  const communities = []
  for (const row of rows) {
    const name     = row[0]?.trim()
    const tableUrl = row[1]?.trim()
    if (!name || name === "Table 1 Community" || !tableUrl?.startsWith("http")) continue

    // Derive city from URL path (e.g. .../orange-county/irvine/crestview → Irvine)
    const parts  = tableUrl.split("/")
    const ocIdx  = parts.findIndex(p => p === "orange-county")
    const city   = ocIdx >= 0 && parts[ocIdx + 1]
      ? parts[ocIdx + 1].split("?")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      : "Irvine"

    const baseUrl          = tableUrl.split("?")[0].split("#")[0]
    const availableHomesUrl = `${baseUrl}?qmi-tab-select#available-homes`

    communities.push({ name, url: baseUrl, availableHomesUrl, city, state: "CA" })
  }

  if (communities.length === 0) throw new Error("No communities found in Sheet Table 1 for Shea Communities")
  console.log(`  Found ${communities.length} community(ies) in Sheet Table 1`)
  return communities
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

function parsePriceFromText(text) {
  const m = text.match(/\$([0-9,]+)/)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ""), 10)
  return isNaN(n) || n < 50000 ? null : n
}

function parseIntFromText(text) {
  if (!text) return null
  const n = parseInt(String(text).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseFloatFromText(text) {
  if (!text) return null
  const n = parseFloat(String(text).replace(/[^0-9.]/g, ""))
  return isNaN(n) ? null : n
}

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(/\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Square|Sq)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// DB helper: get active listings + placeholder buckets
// ---------------------------------------------------------------------------
async function getDbActive(communityName, builderName) {
  const listings = await prisma.listing.findMany({
    where: { community: { name: communityName, builder: { name: builderName } } },
    select: { id: true, address: true, lotNumber: true, currentPrice: true, status: true },
  })
  const active = listings.filter(l => l.status === "active")
  return {
    byAddress:      new Map(active.filter(l => l.address).map(l => [l.address, l])),
    byLotNumber:    new Map(active.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
    placeholders: {
      sold:   listings.filter(l => l.status === "sold"   && /^sold-\d+$/.test(l.lotNumber   ?? "")),
      avail:  listings.filter(l => l.status === "active" && /^avail-\d+$/.test(l.lotNumber  ?? "")),
      future: listings.filter(l => l.status === "future" && /^future-\d+$/.test(l.lotNumber ?? "")),
    },
  }
}

// ---------------------------------------------------------------------------
// Parse a home card from its flattened innerText
// ---------------------------------------------------------------------------
function parseHomeCard(rawText, sourceUrl) {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)

  let homesite = null
  let address  = null
  let plan     = null
  let price    = null
  let sqft     = null
  let beds     = null
  let baths    = null
  let floors   = null
  let isSold   = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^(save to favorites|home tour|view home details|recently sold|home is sold|move-in now|car garage|\d+ photos?)$/i.test(line)) {
      if (/recently sold|home is sold/i.test(line)) isSold = true
      continue
    }

    if (/^Homesite\s+\d+/i.test(line)) { homesite = line.match(/\d+/)[0]; continue }
    if (/^Plan\s+\w+$/i.test(line))    { plan = line; continue }

    if (/Priced From/i.test(line))     { price = parsePriceFromText(line); continue }

    if (/^Sq\.?\s*Ft\.?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d,]+$/.test(prev)) sqft = parseIntFromText(prev)
      continue
    }

    if (/^Story$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^\d+$/.test(prev)) floors = parseInt(prev, 10)
      continue
    }

    if (/^Bedrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) beds = parseFloatFromText(prev)
      continue
    }

    if (/^Bathrooms?$/i.test(line) && i > 0) {
      const prev = lines[i - 1]
      if (/^[\d.]+$/.test(prev)) baths = parseFloatFromText(prev)
      continue
    }

    if (!address && homesite && !plan) {
      if (/^\d+\s+[A-Za-z]/.test(line) && line.length < 60 && !line.includes("$")) {
        address = line
      }
    }
  }

  if (isSold) return null
  if (!homesite && !address) return null

  return { homesite, address: address || null, plan, price, sqft, beds, baths, floors, sourceUrl }
}

// ---------------------------------------------------------------------------
// Scrape a single community's available homes page
// ---------------------------------------------------------------------------
async function scrapeAvailableHomesPage(context, community) {
  console.log(`\n  Scraping: ${community.name}`)
  const page     = await context.newPage()
  const listings = []

  try {
    await page.goto(community.availableHomesUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(5000)

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await page.waitForTimeout(700)
    }
    await page.waitForTimeout(2000)

    const qmiInfo = await page.evaluate(() => {
      const text = document.body?.innerText || ""
      return {
        qmiCount:      (text.match(/Quick Move-ins?\s*\((\d+)\)/i) || [])[1] || null,
        hasQmiSection: !!document.querySelector("section.quick-move-in"),
      }
    })

    console.log(`    QMI count: ${qmiInfo.qmiCount ?? "unknown"} | QMI section: ${qmiInfo.hasQmiSection}`)

    if (!qmiInfo.hasQmiSection) {
      console.log("    No QMI section — community may have no available homes")
      return listings
    }

    const rawCards = await page.evaluate(() => {
      const qmiSection    = document.querySelector("section.quick-move-in")
      if (!qmiSection) return []
      const titleLinks    = Array.from(qmiSection.querySelectorAll("a.home-card_content-title"))
      const homesiteLinks = titleLinks.filter(a => a.href && a.href.includes("homesite"))
      return homesiteLinks.map(a => {
        let el = a
        for (let i = 0; i < 10; i++) {
          el = el.parentElement
          if (!el) break
          const text = el.innerText || ""
          if (text.includes("Sq. Ft.") || text.includes("Bedrooms")) break
        }
        return { href: a.href, rawText: el ? el.innerText : a.innerText }
      })
    })

    console.log(`    Found ${rawCards.length} homesite card(s)`)

    for (const card of rawCards) {
      const parsed = parseHomeCard(card.rawText, card.href)
      if (!parsed) { console.log(`    Skipped sold/invalid card`); continue }
      console.log(`    Card: HS${parsed.homesite} "${parsed.address}" ${parsed.plan} $${parsed.price?.toLocaleString() ?? "N/A"} ${parsed.sqft}sqft ${parsed.beds}bd ${parsed.baths}ba`)
      listings.push(parsed)
    }
  } catch (err) {
    console.warn(`    Error scraping ${community.name}: ${err.message}`)
  } finally {
    await page.close()
  }

  return listings
}

// ---------------------------------------------------------------------------
// POST to ingest endpoint
// ---------------------------------------------------------------------------
async function postIngest(payload) {
  const res = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify(payload),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Ingest error ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log("Shea Homes Orange County Scraper (diff-based)")
  console.log("=".repeat(60))

  // Step 1: Load community list from Sheet Table 1
  console.log("\n[Step 1] Reading communities from Google Sheet Table 1...")
  const sheetCommunities = await getCommunitiesFromSheet()

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport:  { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })

  const summary = { new: 0, priceChanges: 0, sold: 0 }
  const results = []

  try {
    for (const commDef of sheetCommunities) {
      const resolvedName = await resolveDbCommunityName(commDef.name, BUILDER_NAME, prisma)
      console.log(`\n${"─".repeat(60)}`)
      console.log(`Community: ${resolvedName} (${commDef.city}, ${commDef.state})`)

      // Step 2: Scrape available homes
      const scraped = await scrapeAvailableHomesPage(context, { ...commDef, name: resolvedName })
      console.log(`  Scraped: ${scraped.length}`)

      // Step 3: Query DB
      const db = await getDbActive(resolvedName, BUILDER_NAME)
      console.log(`  DB active: ${db.byAddress.size}`)

      const newListings  = []
      const priceUpdates = []
      const soldListings = []

      const scrapedByAddress = new Map()
      const scrapedByLot     = new Map()

      for (const item of scraped) {
        const lotNumber = item.homesite ? compositeKey(resolvedName, String(item.homesite).padStart(4, "0")) : null
        const rawAddr   = item.address || null
        if (!rawAddr && !lotNumber) continue
        const address = rawAddr ? normalizeAddress(rawAddr.trim()) : null
        if (address) scrapedByAddress.set(address, { ...item, address, lotNumber })
        if (lotNumber) scrapedByLot.set(lotNumber, { ...item, address, lotNumber })
      }

      // Detect new and price-changed
      for (const [address, item] of scrapedByAddress) {
        let dbEntry = db.byAddress.get(address)
        if (!dbEntry && item.lotNumber) dbEntry = db.byLotNumber.get(item.lotNumber)

        if (!dbEntry) {
          newListings.push({
            address,
            lotNumber:    item.lotNumber || null,
            floorPlan:    item.plan      || null,
            currentPrice: item.price     || null,
            status:       "active",
            sourceUrl:    item.sourceUrl || null,
            sqft:         item.sqft      || null,
            beds:         item.beds      || null,
            baths:        item.baths     || null,
            floors:       item.floors    || null,
            pricePerSqft: item.price && item.sqft ? Math.round(item.price / item.sqft) : null,
          })
        } else if (item.price && dbEntry.currentPrice !== item.price) {
          priceUpdates.push({ address, currentPrice: item.price, status: "active", sourceUrl: item.sourceUrl || null })
        }
      }

      // Detect sold
      for (const [addr, dbEntry] of db.byAddress) {
        const inScraped    = scrapedByAddress.has(addr)
        const lotInScraped = dbEntry.lotNumber ? scrapedByLot.has(dbEntry.lotNumber) : false
        if (!inScraped && !lotInScraped) {
          soldListings.push({ address: addr, status: "sold", soldAt: new Date().toISOString() })
        }
      }

      // Step 4: Sync Table 2 placeholders
      const sheetCounts = await fetchTable2Counts(SHEET_TAB)
      const commCounts  = sheetCounts[resolvedName] || null
      const phChanges   = []
      if (commCounts) {
        const { toIngest: phIngest, removeIds } = reconcilePlaceholders(commCounts, db.placeholders)
        phChanges.push(...phIngest)
        if (removeIds.length > 0) {
          await prisma.listing.updateMany({ where: { id: { in: removeIds } }, data: { status: "removed" } })
          console.log(`  Placeholders removed: ${removeIds.length}`)
        }
        if (phIngest.length > 0) {
          console.log(`  Placeholders synced: +${phIngest.filter(l => l.status === "sold").length} sold, +${phIngest.filter(l => l.status === "active").length} avail, +${phIngest.filter(l => l.status === "future").length} future`)
        }
      }

      console.log(`  Diff — New: ${newListings.length}, Price changes: ${priceUpdates.length}, Sold: ${soldListings.length}`)

      const allChanges = [...newListings, ...priceUpdates, ...soldListings, ...phChanges]
      if (allChanges.length === 0) {
        console.log("  No changes — skipping ingest POST")
        results.push({ community: resolvedName, changes: 0 })
        await new Promise(r => setTimeout(r, 2000))
        continue
      }

      const payload = {
        builder:     { name: BUILDER_NAME, websiteUrl: "https://www.sheahomes.com" },
        community:   { name: resolvedName, city: commDef.city, state: commDef.state, url: commDef.url },
        listings:    allChanges,
        scraperMode: true,
      }

      console.log(`  POSTing ${allChanges.length} listing change(s) to ingest...`)
      try {
        const result = await postIngest(payload)
        console.log("  Ingest result:", JSON.stringify(result))
        summary.new          += newListings.length
        summary.priceChanges += priceUpdates.length
        summary.sold         += soldListings.length
        results.push({
          community:     resolvedName,
          changes:       newListings.length + priceUpdates.length + soldListings.length,
          newCount:      newListings.length,
          soldCount:     soldListings.length,
          priceCount:    priceUpdates.length,
          newAddresses:  newListings.map(l => l.address).filter(Boolean),
          soldAddresses: soldListings.map(l => l.address).filter(Boolean),
          priceDetails:  priceUpdates.map(l => ({ address: l.address, from: 0, to: l.currentPrice ?? 0 })),
        })
      } catch (err) {
        console.error("  Ingest failed:", err.message)
      }

      await new Promise(r => setTimeout(r, 2000))
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }

  console.log("\n" + "=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`New listings:   ${summary.new}`)
  console.log(`Price changes:  ${summary.priceChanges}`)
  console.log(`Sold listings:  ${summary.sold}`)

  await sendWhatsApp(buildSummary("Shea Homes", results, ((Date.now() - startTime) / 1000).toFixed(1)))
}

main().catch(async err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  const root = (err.stack || err.message || String(err)).split("\n").slice(0, 4).join("\n")
  await sendWhatsApp(`🚨 *New Key — Shea Homes Scraper CRASHED*\n\n${root}`)
  process.exit(1)
})
