/**
 * Brookfield Residential OC Scraper — diff-based
 *
 * 1. Hardcoded QMI URLs for "Vista in Summit Collection" (Irvine, OC).
 * 2. Query DB for current active listings.
 * 3. Diff against DB:
 *    - URLs NOT in DB → new → visit detail page and ingest.
 *    - Active in DB but NOT in QMI URLs → mark sold.
 *    - In both → skip detail page visit; only check price via lightweight scrape.
 * 4. Only POST to ingest if changes exist.
 *
 * Run: node scripts/scrape-brookfield.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"
import { resolveDbCommunityName } from "../../lib/resolve-community-name.mjs"
import { sendWhatsApp, buildSummary } from "../../lib/notify.mjs"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, '../../.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}
const { PrismaClient } = require('../../node_modules/@prisma/client')
const prisma = new PrismaClient()

const INGEST_URL    = "https://www.newkey.us/api/ingest"
const INGEST_SECRET = process.env.INGEST_SECRET
if (!INGEST_SECRET) throw new Error("INGEST_SECRET is required")
const BUILDER_NAME  = "Brookfield Residential"
const USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const SHEET_ID      = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const BROOKFIELD_TAB = "Brookfield"

const COMMUNITY_NAME = "Vista in Summit Collection"
const COMMUNITY_CITY = "Irvine"
const COMMUNITY_STATE = "CA"
const BROOKFIELD_COMMUNITY_URL =
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit"

// Hardcoded QMI URLs
const QMI_URLS = [
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/536-peninsula-unit-000104",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/548-fieldhouse-unit-000024",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/536-sahara-unit-000026",
  "https://www.brookfieldresidential.com/new-homes/california/orange-county/irvine/orchard-hills/vista-in-summit/540-sahara-unit-000025",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toTitleCase(str) {
  if (!str) return ""
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function normalizeAddress(addr) {
  if (!addr) return ""
  return addr
    .replace(/\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Derive address from QMI URL slug (e.g. "536-peninsula-unit-000104" → "536 Peninsula")
function addressFromUrl(url) {
  const slug    = url.split("/").pop() || ""
  const addrSlug = slug.replace(/-unit-\d+$/i, "")
  return addrSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

// Derive lot number from QMI URL slug (e.g. "unit-000104" → "104")
function lotFromUrl(url) {
  const m = url.match(/unit-0*(\d+)$/i)
  return m ? m[1] : null
}

function compositeKey(communityName, rawLot) {
  return communityName.replace(/\s+/g, "") + String(rawLot)
}

function parseCsvLine(line) {
  const cols = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && inQuotes && next === '"') {
      current += '"'
      i++
    } else if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  cols.push(current.trim())
  return cols
}

function cityFromUrl(url) {
  const m = url.match(/\/new-homes\/california\/[^/]+\/([^/?#]+)\//i)
  return m ? toTitleCase(m[1].replace(/-/g, " ")) : COMMUNITY_CITY
}

function communityNameFromRow(row) {
  if (row.communityName.toLowerCase() === "vista" && row.url.includes("vista-in-summit")) {
    return COMMUNITY_NAME
  }
  return row.communityName
}

async function fetchBrookfieldRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(BROOKFIELD_TAB)}`
  const res = await fetch(url, { cache: "no-store", redirect: "follow" })
  if (!res.ok) throw new Error(`Failed to fetch Brookfield tab: HTTP ${res.status}`)

  const rows = (await res.text()).split(/\r?\n/).filter(Boolean).map(parseCsvLine)
  return rows
    .slice(1)
    .map((cols) => ({
      communityName: cols[0]?.trim() || "",
      url: cols[1]?.trim() || "",
      city: cityFromUrl(cols[1]?.trim() || ""),
    }))
    .filter((row) =>
      row.communityName &&
      row.url.startsWith("http") &&
      row.url.includes("brookfieldresidential.com")
    )
}

async function discoverQmiUrls(page, communityUrl) {
  console.log(`Discovering QMI links from: ${communityUrl}`)
  await page.goto(communityUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(4000)

  const urls = await page.evaluate((baseUrl) => {
    const normalizedBase = baseUrl.replace(/\/+$/, "")
    const found = new Set()
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href
      if (!href || !href.includes("unit-")) return
      if (!href.startsWith(normalizedBase)) return
      found.add(href.split("#")[0])
    })
    return [...found]
  }, communityUrl)

  console.log(`Discovered ${urls.length} QMI link(s)`)
  return urls
}

// ---------------------------------------------------------------------------
// DB helper: get active listings indexed by address and lotNumber
// ---------------------------------------------------------------------------
async function getDbActive(communityName, builderName) {
  const listings = await prisma.listing.findMany({
    where: {
      community: { name: communityName, builder: { name: builderName } },
    },
    select: { id: true, address: true, lotNumber: true, currentPrice: true, sourceUrl: true, status: true },
  })
  return {
    byAddress:   new Map(listings.filter(l => l.address).map(l => [l.address.toLowerCase(), l])),
    byLotNumber: new Map(listings.filter(l => l.lotNumber).map(l => [l.lotNumber, l])),
    bySourceUrl: new Map(listings.filter(l => l.sourceUrl).map(l => [l.sourceUrl, l])),
    all:         listings,
  }
}

// ---------------------------------------------------------------------------
// Scrape a QMI detail page (full detail — only called for new listings)
// ---------------------------------------------------------------------------
async function scrapeQmiPage(page, url) {
  console.log(`  Visiting (new): ${url}`)
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(3000)

  const data = await page.evaluate(() => {
    const bodyText = document.body?.innerText || ""

    const h1 = document.querySelector("h1, [class*='home-address'], [class*='address-heading']")
    let address = h1?.innerText?.trim().split("\n")[0] || ""

    if (!address) {
      const pathParts = window.location.pathname.split("/")
      const slug = pathParts[pathParts.length - 1] || ""
      const addrSlug = slug.replace(/-unit-\d+$/i, "")
      address = addrSlug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    }

    const lotM     = bodyText.match(/Lot[:\s]+(\w+)/i)
    let lotNumber  = lotM ? lotM[1] : null
    if (!lotNumber) {
      const urlLot = window.location.pathname.match(/unit-0*(\d+)$/i)
      if (urlLot) lotNumber = urlLot[1]
    }

    const sqftM  = bodyText.match(/([\d,]+)\s*ft\s*[²2]/i) || bodyText.match(/([\d,]+)\s*sq\s*ft/i)
    const bedsM  = bodyText.match(/([\d]+)\s*beds/i)
    const bathsM = bodyText.match(/([\d]+)\s*baths/i)
    const storiesM = bodyText.match(/Stories:\s*([\d]+)/i) || bodyText.match(/([\d]+)\s*stories/i) || bodyText.match(/([\d]+)\s*story/i)
    const garM   = bodyText.match(/Parking\/Garage:\s*([\d]+)/i) || bodyText.match(/([\d]+)\s*car\s*garage/i) || bodyText.match(/([\d]+)\s*garage/i)
    const planM  = bodyText.match(/Plan:\s*([^\n]+)/i)
    const moveInM = bodyText.match(/MOVE\s*IN\s+([A-Za-z]+\s+\d{4})/i)
    const priceM  = bodyText.match(/\$([\d,]+(?:\.\d+)?)/)
    const callForPrice = /Call For Pricing/i.test(bodyText)

    let propertyType = null
    if (/single.family/i.test(bodyText)) propertyType = "Single Family"
    else if (/townhome|townhouse/i.test(bodyText)) propertyType = "Townhome"
    else if (/condo/i.test(bodyText)) propertyType = "Condo"

    return {
      address,
      lotNumber,
      sqft:         sqftM    ? parseInt(sqftM[1].replace(/,/g, ""), 10) : null,
      beds:         bedsM    ? parseFloat(bedsM[1]) : null,
      baths:        bathsM   ? parseFloat(bathsM[1]) : null,
      floors:       storiesM ? parseInt(storiesM[1], 10) : null,
      garages:      garM     ? parseInt(garM[1], 10) : null,
      floorPlan:    planM    ? planM[1].trim() : null,
      moveInDate:   moveInM  ? moveInM[1] : null,
      price:        priceM   ? parseInt(priceM[1].replace(/,/g, ""), 10) : null,
      callForPrice,
      propertyType,
    }
  })

  if (data.address) {
    data.address = normalizeAddress(toTitleCase(data.address))
  }
  if (!data.address) {
    data.address = addressFromUrl(url)
  }

  console.log(`    Address: ${data.address} | ${data.floorPlan} | ${data.beds}bd ${data.baths}ba ${data.sqft}sqft | move-in: ${data.moveInDate} | price: ${data.callForPrice ? "Call For Pricing" : "$" + data.price}`)
  return { ...data, sourceUrl: url }
}

// ---------------------------------------------------------------------------
// Lightweight price-check scrape (for existing listings — skip full detail)
// ---------------------------------------------------------------------------
async function scrapePriceOnly(page, url) {
  console.log(`  Price-check (existing): ${url}`)
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2000)

  const data = await page.evaluate(() => {
    const bodyText = document.body?.innerText || ""
    const priceM   = bodyText.match(/\$([\d,]+(?:\.\d+)?)/)
    const callForPrice = /Call For Pricing/i.test(bodyText)
    return {
      price: priceM ? parseInt(priceM[1].replace(/,/g, ""), 10) : null,
      callForPrice,
    }
  })

  return data
}

// ---------------------------------------------------------------------------
// POST to ingest endpoint
// ---------------------------------------------------------------------------
async function postIngest(payload) {
  const res = await fetch(INGEST_URL, {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-ingest-secret": INGEST_SECRET,
    },
    body: JSON.stringify(payload),
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
  console.log("Brookfield Residential OC Scraper (diff-based)")
  console.log("=".repeat(60))

  const sheetRows = await fetchBrookfieldRows()
  const activeCommunity = sheetRows[0] ?? {
    communityName: COMMUNITY_NAME,
    url: BROOKFIELD_COMMUNITY_URL,
    city: COMMUNITY_CITY,
  }
  if (sheetRows.length === 0) {
    console.warn(`Brookfield tab had no usable rows; falling back to ${COMMUNITY_NAME}`)
  } else if (sheetRows.length > 1) {
    console.warn(`Brookfield tab has ${sheetRows.length} rows; this scraper will use the first row for tomorrow's run.`)
  }

  const resolvedName = await resolveDbCommunityName(communityNameFromRow(activeCommunity), BUILDER_NAME, prisma)
  const communityCity = activeCommunity.city || COMMUNITY_CITY
  const communityUrl = activeCommunity.url
  console.log(`Community: ${resolvedName} (${communityCity})`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  })
  let page = await context.newPage()

  let qmiUrls = await discoverQmiUrls(page, communityUrl)
  if (qmiUrls.length === 0 && communityUrl === BROOKFIELD_COMMUNITY_URL) {
    console.warn("No QMI links discovered from page; using legacy Vista fallback URLs.")
    qmiUrls = QMI_URLS
  }
  if (qmiUrls.length === 0) {
    throw new Error(`No Brookfield QMI links discovered for ${resolvedName}; skipping scrape to avoid false sold updates.`)
  }

  // Query DB active listings
  const db = await getDbActive(resolvedName, BUILDER_NAME)
  console.log(`DB active listings: ${db.all.length}`)

  // Build set of QMI URL-derived addresses/lots for sold detection
  const qmiAddresses = new Set(qmiUrls.map(u => addressFromUrl(u).toLowerCase()))
  const qmiLots      = new Set(qmiUrls.map(u => lotFromUrl(u)).filter(Boolean).map(l => compositeKey(resolvedName, l)))
  const qmiSourceUrls = new Set(qmiUrls)

  // Classify each QMI URL
  const newUrls     = []
  const existingUrls = []

  for (const url of qmiUrls) {
    const derivedAddr = addressFromUrl(url).toLowerCase()
    const derivedLot  = lotFromUrl(url)

    const inDb = db.bySourceUrl.has(url)
      || db.byAddress.has(derivedAddr)
      || (derivedLot && (
        db.byLotNumber.has(derivedLot) ||
        db.byLotNumber.has(compositeKey(resolvedName, derivedLot))
      ))

    if (inDb) {
      existingUrls.push(url)
    } else {
      newUrls.push(url)
    }
  }

  console.log(`New (need detail visit): ${newUrls.length} | Existing (price-check only): ${existingUrls.length}`)

  // Detect sold: active in DB but sourceUrl not in QMI_URLS and address/lot not in QMI set
  const soldListings = []
  for (const dbL of db.all) {
    if (dbL.status === "sold") continue
    const addrMatch = dbL.address && qmiAddresses.has(dbL.address.toLowerCase())
    const lotMatch  = dbL.lotNumber && qmiLots.has(dbL.lotNumber)
    const urlMatch  = dbL.sourceUrl && qmiSourceUrls.has(dbL.sourceUrl)
    if (!addrMatch && !lotMatch && !urlMatch) {
      soldListings.push({ address: dbL.address, status: "sold", soldAt: new Date().toISOString() })
    }
  }

  const newListings  = []
  const priceUpdates = []

  try {
    // Visit new URLs for full detail
    for (const url of newUrls) {
      try {
        const home = await scrapeQmiPage(page, url)
        const price = home.price || null
        newListings.push({
          address:      home.address,
          lotNumber:    home.lotNumber ? compositeKey(resolvedName, home.lotNumber) : null,
          currentPrice: price,
          moveInDate:   home.moveInDate || null,
          status:       price ? "for sale" : "future release",
          sourceUrl:    home.sourceUrl,
          floorPlan:    home.floorPlan || null,
          sqft:         home.sqft || null,
          beds:         home.beds || null,
          baths:        home.baths || null,
          garages:      home.garages || null,
          floors:       home.floors || null,
          propertyType: home.propertyType || null,
          pricePerSqft: price && home.sqft ? Math.round(price / home.sqft) : null,
        })
        await new Promise(r => setTimeout(r, 1500))
      } catch (err) {
        console.warn(`  Warning: Failed to scrape ${url}: ${err.message}`)
      }
    }

    // Price-check existing URLs
    for (const url of existingUrls) {
      try {
        const { price } = await scrapePriceOnly(page, url)

        // Find the DB entry for this URL
        const derivedAddr = addressFromUrl(url).toLowerCase()
        const derivedLot  = lotFromUrl(url)
        const dbEntry = db.bySourceUrl.get(url)
          || db.byAddress.get(derivedAddr)
          || (derivedLot ? (
            db.byLotNumber.get(derivedLot) ||
            db.byLotNumber.get(compositeKey(resolvedName, derivedLot))
          ) : null)

        if (dbEntry && price && dbEntry.currentPrice !== price) {
          priceUpdates.push({
            address:      dbEntry.address,
            currentPrice: price,
            status:       "for sale",
            sourceUrl:    url,
          })
          console.log(`    Price change detected: ${dbEntry.address} $${dbEntry.currentPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
        } else {
          console.log(`    No price change: ${derivedAddr} ($${price?.toLocaleString() ?? "N/A"})`)
        }

        await new Promise(r => setTimeout(r, 1000))
      } catch (err) {
        console.warn(`  Warning: Price check failed for ${url}: ${err.message}`)
      }
    }
  } finally {
    if (page) await page.close()
    await browser.close()
  }

  console.log(`\nNew: ${newListings.length} | Price changes: ${priceUpdates.length} | Sold: ${soldListings.length}`)

  const hasChanges = newListings.length > 0 || priceUpdates.length > 0 || soldListings.length > 0
  if (!hasChanges) {
    console.log("No changes — skipping ingest POST")
    await prisma.$disconnect()
    console.log("\n" + "=".repeat(60))
    console.log("Done.")
    console.log("=".repeat(60))
    {
      const _d = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      const _elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      await sendWhatsApp([`🏠 *New Key — Brookfield Scraper*`, `📅 ${_d}`, ``, `✅ No changes found`, ``, `⏱ ${_elapsed}s`].join("\n"))
    }
    return
  }

  const payload = {
    builder:   { name: BUILDER_NAME, websiteUrl: "https://www.brookfieldresidential.com" },
    community: { name: resolvedName, city: communityCity, state: COMMUNITY_STATE, url: communityUrl },
    listings:  [...newListings, ...priceUpdates, ...soldListings],
  }

  console.log(`POSTing ${payload.listings.length} listing(s) to ingest...`)
  try {
    const result = await postIngest(payload)
    console.log("Ingest result:", result)
  } catch (err) {
    console.error("Ingest failed:", err.message)
  }

  await prisma.$disconnect()

  console.log("\n" + "=".repeat(60))
  console.log("Done.")
  console.log("=".repeat(60))

  {
    const _elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const _results = [{
      community:     resolvedName,
      changes:       newListings.length + priceUpdates.length + soldListings.length,
      newCount:      newListings.length,
      soldCount:     soldListings.length,
      priceCount:    priceUpdates.length,
      newAddresses:  newListings.map(l => l.address).filter(Boolean),
      soldAddresses: soldListings.map(l => l.address).filter(Boolean),
    }]
    await sendWhatsApp(buildSummary("Brookfield", _results, _elapsed))
  }
}

main().catch(async err => {
  console.error("Fatal error:", err)
  prisma.$disconnect()
  const root = (err.stack || err.message || String(err)).split("\n").slice(0, 4).join("\n")
  await sendWhatsApp(`🚨 *New Key — Brookfield Scraper CRASHED*\n\n${root}`)
  process.exit(1)
})
