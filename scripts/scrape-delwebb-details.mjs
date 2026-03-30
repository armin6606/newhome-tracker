/**
 * Scrape Del Webb detail pages for HOA, move-in date, schools.
 * 1. Re-fetch QMI API for each community to get all active listings
 * 2. Visit each listing's inventoryPageURL on www.delwebb.com to scrape:
 *    - HOA fees
 *    - Move-in date / estimated completion
 *    - Schools
 * 3. Upsert listings in DB with full detail
 *
 * Run: node --env-file=.env.local scripts/scrape-delwebb-details.mjs
 */
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"

const prisma = new PrismaClient()

const COMMUNITIES = [
  {
    dbId: 79,
    name: "Luna at Gavilan Ridge",
    communityId: "211498",
    baseUrl: "https://www.delwebb.com",
    apiUrl: "https://www.delwebb.com/api/plan/qmiplans?communityId=211498",
    communityUrl: "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/luna-at-gavilan-ridge-211498",
  },
  {
    dbId: 168,
    name: "Elara at Gavilan Ridge",
    communityId: "211497",
    baseUrl: "https://www.delwebb.com",
    apiUrl: "https://www.delwebb.com/api/plan/qmiplans?communityId=211497",
    communityUrl: "https://www.delwebb.com/homes/california/orange-county/rancho-mission-viejo/elara-at-gavilan-ridge-211497",
  },
]

// Street suffixes to strip from addresses (per project memory rules)
const SUFFIX_RE = /\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?/gi

function cleanAddress(raw) {
  if (!raw) return null
  // Remove everything after comma (city, state, zip)
  let addr = raw.replace(/,.*$/, "").trim()
  // Strip street type suffixes
  addr = addr.replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim()
  return addr || null
}

function parsePriceInt(val) {
  if (!val) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

async function fetchQmiApi(page, apiUrl) {
  try {
    const resp = await page.request.get(apiUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.delwebb.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    })
    if (!resp.ok()) {
      console.log(`  API ${apiUrl} returned status ${resp.status()}`)
      return []
    }
    const data = await resp.json()
    return data
  } catch (e) {
    console.log(`  Error fetching API: ${e.message?.slice(0, 80)}`)
    return []
  }
}

/**
 * Extract individual QMI home entries from the API response.
 * The Del Webb QMI API returns a FLAT array — each element is one home.
 * Fields confirmed from live API:
 *   address.street1, price, bedrooms, bathrooms, totalBaths, squareFeet,
 *   floors, garages, planName, lotBlock, inventoryPageURL, dateAvailable
 *
 * Returns array of { rawAddress, price, beds, baths, sqft, floors, garages, moveIn, plan, lot, inventoryPageURL }
 */
function extractHomes(data) {
  const homes = []
  // Try flat array first (confirmed format), then nested formats
  const topLevelItems = Array.isArray(data) ? data : (data?.plans || data?.qmiPlans || data?.homes || [])

  for (const item of topLevelItems) {
    // Check if this item is a flat home (has address directly) or a plan container (has qmiHomes)
    const qmiHomes = item?.qmiHomes || item?.homes
    const itemList = qmiHomes?.length > 0 ? qmiHomes : [item]

    for (const home of itemList) {
      const addrObj = home?.address
      const rawAddress =
        addrObj?.street1?.trim() ||
        addrObj?.street ||
        addrObj?.streetAddress ||
        home?.streetAddress ||
        (typeof addrObj === "string" ? addrObj : null)

      const price = home?.price ?? home?.finalPrice ?? home?.basePrice ?? home?.listPrice ?? null
      const beds = home?.bedrooms ?? home?.beds ?? null
      const baths = home?.totalBaths ?? home?.bathrooms ?? home?.baths ?? null
      const sqft = home?.squareFeet ?? home?.sqft ?? null
      const floors = home?.floors ?? home?.stories ?? null
      const garages = home?.garages ?? home?.garageSpaces ?? null
      // dateAvailable is the primary field; fall back to other date fields
      const moveIn =
        home?.dateAvailable ??
        home?.moveInDate ?? home?.estimatedCompletionDate ?? home?.availableDate ??
        home?.estimatedDeliveryDate ?? home?.deliveryDate ?? null
      const plan = home?.planName ?? home?.floorPlan ?? item?.planName ?? item?.name ?? null
      const lot = home?.lotBlock ?? home?.lotNumber ?? home?.homesite ?? home?.homesiteNumber ?? null
      const inventoryPageURL = home?.inventoryPageURL ?? home?.inventoryPageUrl ?? home?.detailUrl ?? null

      if (rawAddress || price || inventoryPageURL) {
        homes.push({ rawAddress, price, beds, baths, sqft, floors, garages, moveIn, plan, lot, inventoryPageURL })
      }
    }
  }
  return homes
}

/**
 * Visit a Del Webb detail page and scrape HOA, moveInDate, schools.
 */
async function scrapeDetailPage(page, detailUrl) {
  const result = { hoaFees: null, moveInDate: null, schools: null }
  try {
    console.log(`    → Visiting detail page: ${detailUrl}`)
    await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
    await page.waitForTimeout(3000)

    // Scroll to load lazy sections
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 600))
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(1500)

    // Try to extract from __NEXT_DATA__ first (Pulte/Del Webb uses Next.js)
    const nextData = await page.evaluate(() => {
      try {
        const el = document.getElementById("__NEXT_DATA__")
        return el ? JSON.parse(el.textContent) : null
      } catch { return null }
    })

    if (nextData) {
      console.log(`      __NEXT_DATA__ found, scanning for HOA/moveIn/schools...`)
      const str = JSON.stringify(nextData)

      // Extract HOA
      const hoaPatterns = [
        /"monthlyHoa"\s*:\s*(\d+)/,
        /"hoa"\s*:\s*(\d+)/,
        /"hoaFee"\s*:\s*(\d+)/,
        /"hoaFees"\s*:\s*(\d+)/,
        /"hoaMonthly"\s*:\s*(\d+)/,
        /"associationFee"\s*:\s*(\d+)/,
        /"monthlyAssociationFee"\s*:\s*(\d+)/,
      ]
      for (const pat of hoaPatterns) {
        const m = str.match(pat)
        if (m) {
          result.hoaFees = parseInt(m[1], 10)
          console.log(`      HOA from JSON: $${result.hoaFees}`)
          break
        }
      }

      // Extract move-in date
      const moveInPatterns = [
        /"moveInDate"\s*:\s*"([^"]+)"/,
        /"estimatedCompletionDate"\s*:\s*"([^"]+)"/,
        /"estimatedDeliveryDate"\s*:\s*"([^"]+)"/,
        /"availableDate"\s*:\s*"([^"]+)"/,
        /"completionDate"\s*:\s*"([^"]+)"/,
        /"deliveryDate"\s*:\s*"([^"]+)"/,
      ]
      for (const pat of moveInPatterns) {
        const m = str.match(pat)
        if (m && m[1] && m[1].length > 1 && m[1] !== "null") {
          result.moveInDate = m[1]
          console.log(`      MoveIn from JSON: ${result.moveInDate}`)
          break
        }
      }

      // Extract schools — look for school names in arrays
      const schoolPatterns = [
        /"schools"\s*:\s*(\[[^\]]+\])/,
        /"schoolDistrict"\s*:\s*"([^"]+)"/,
        /"elementarySchool"\s*:\s*"([^"]+)"/,
      ]
      for (const pat of schoolPatterns) {
        const m = str.match(pat)
        if (m && m[1] && m[1].length > 2) {
          try {
            const parsed = JSON.parse(m[1])
            result.schools = Array.isArray(parsed) ? parsed.join(", ") : m[1]
          } catch {
            result.schools = m[1]
          }
          console.log(`      Schools from JSON: ${result.schools?.slice(0, 80)}`)
          break
        }
      }
    }

    // ── DOM scraping ────────────────────────────────────────
    // Del Webb detail page structure (verified 2026-03-19):
    //   "May 2026\nAnticipated completion date" — label is BELOW the value
    // Page has no HOA or schools sections.
    const domResult = await page.evaluate(() => {
      let hoaFees = null
      let moveInDate = null
      let schools = null

      const bodyText = document.body?.innerText || ""

      // "Anticipated completion date" label — value is on the line above
      // Pattern in inner text: "May 2026\nAnticipated completion date"
      const anticipatedM = bodyText.match(/([A-Za-z]+ \d{4})\s*\nAnticipated completion date/i)
      if (anticipatedM) moveInDate = anticipatedM[1].trim()

      // Also try "Available Now" pattern
      if (!moveInDate && /Available Now\s*\nAnticipated completion date/i.test(bodyText)) {
        moveInDate = "Available Now"
      }

      // General date pattern before "Anticipated completion" or "Move-in"
      if (!moveInDate) {
        const dateM = bodyText.match(/([A-Za-z]+ \d{4}|Available Now)\s*(?:\r?\n|\s)+(?:Anticipated completion date|Move-in date|Move In date)/i)
        if (dateM) moveInDate = dateM[1].trim()
      }

      // HOA: look for any section with HOA or Association
      const hoaM = bodyText.match(/(?:hoa|homeowners? association|monthly (?:hoa|fee|dues))[^\n]*?\$?\s*([\d,]+)/i)
      if (hoaM) {
        const v = parseInt(hoaM[1].replace(/,/g, ""), 10)
        if (v > 0 && v < 5000) hoaFees = v
      }

      return { hoaFees, moveInDate, schools }
    })

    // Merge — prefer JSON data over DOM
    if (!result.hoaFees && domResult.hoaFees) {
      result.hoaFees = domResult.hoaFees
      console.log(`      HOA from DOM: $${result.hoaFees}`)
    }
    if (!result.moveInDate && domResult.moveInDate) {
      result.moveInDate = domResult.moveInDate
      console.log(`      MoveIn from DOM: ${result.moveInDate}`)
    }
    if (!result.schools && domResult.schools) {
      result.schools = domResult.schools
      console.log(`      Schools from DOM: ${result.schools?.slice(0, 80)}`)
    }

    // Additional fallback: scan __NEXT_DATA__ for community-level HOA
    if (!result.hoaFees && nextData) {
      // Try broader HOA scan with any numeric field near "hoa"
      const str = JSON.stringify(nextData)
      const hoaAny = str.match(/"[^"]*[Hh][Oo][Aa][^"]*"\s*:\s*"?\$?([\d,]+)"?/)
      if (hoaAny) {
        const v = parseInt(hoaAny[1].replace(/,/g, ""), 10)
        if (v > 0 && v < 10000) {
          result.hoaFees = v
          console.log(`      HOA from broad JSON scan: $${result.hoaFees}`)
        }
      }
    }

  } catch (e) {
    console.log(`      Error scraping detail page: ${e.message?.slice(0, 100)}`)
  }

  return result
}

async function main() {
  console.log("=".repeat(60))
  console.log("Del Webb Detail Page Scraper")
  console.log("=".repeat(60))

  const builder = await prisma.builder.findFirst({ where: { name: "Del Webb" } })
  if (!builder) {
    console.error("Builder 'Del Webb' not found in DB")
    process.exit(1)
  }
  console.log(`\nBuilder: Del Webb (id=${builder.id})`)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()

  // Warm up — get cookies/session
  console.log("\nWarming up on Del Webb site...")
  try {
    await page.goto(COMMUNITIES[0].communityUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(2000)
    console.log("Warm-up complete.")
  } catch (e) {
    console.log(`Warm-up error (non-fatal): ${e.message?.slice(0, 60)}`)
  }

  let totalCreated = 0
  let totalUpdated = 0
  let totalRemoved = 0

  for (const comm of COMMUNITIES) {
    console.log(`\n${"═".repeat(60)}`)
    console.log(`Community: ${comm.name} (dbId=${comm.dbId}, communityId=${comm.communityId})`)

    const community = await prisma.community.findUnique({ where: { id: comm.dbId } })
    if (!community) {
      console.log(`  Community id=${comm.dbId} not found in DB, skipping`)
      continue
    }

    // ── 1. Fetch QMI API ──────────────────────────────────────
    console.log(`\n  Fetching API: ${comm.apiUrl}`)
    const raw = await fetchQmiApi(page, comm.apiUrl)

    const apiType = Array.isArray(raw) ? `array[${raw.length}]` : typeof raw
    console.log(`  API response type: ${apiType}`)

    if (Array.isArray(raw) && raw.length > 0) {
      console.log(`  First item keys: ${Object.keys(raw[0]).join(", ")}`)
      const firstSub = raw[0]?.qmiHomes || raw[0]?.homes
      if (firstSub?.length > 0) {
        console.log(`  Sub-items[0] keys: ${Object.keys(firstSub[0]).join(", ")}`)
      }
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      console.log(`  Object keys: ${Object.keys(raw).join(", ")}`)
    }

    const homes = extractHomes(raw)
    console.log(`  Extracted ${homes.length} home(s) from API`)

    // ── 2. Get current active DB listings for this community ──
    const activeDbListings = await prisma.listing.findMany({
      where: { communityId: community.id, status: "active" },
    })
    console.log(`  Current active DB listings: ${activeDbListings.length}`)

    const foundAddresses = new Set()

    // ── 3. For each home: visit detail page, scrape, upsert ──
    for (const h of homes) {
      const addr = cleanAddress(h.rawAddress)
      console.log(`\n  ── Home: ${JSON.stringify(h.rawAddress)} → "${addr}"`)
      console.log(`     plan=${h.plan} lot=${h.lot} price=$${h.price?.toLocaleString()} beds=${h.beds} baths=${h.baths} sqft=${h.sqft} floors=${h.floors} garages=${h.garages}`)
      console.log(`     moveIn=${h.moveIn} inventoryPageURL=${h.inventoryPageURL}`)

      if (!addr || !/^\d/.test(addr)) {
        console.log(`     ✗ Skipping — no valid street address`)
        continue
      }

      foundAddresses.add(addr)

      // Build detail page URL
      let detailUrl = null
      if (h.inventoryPageURL) {
        // Could be relative or absolute
        if (h.inventoryPageURL.startsWith("http")) {
          detailUrl = h.inventoryPageURL
        } else {
          detailUrl = comm.baseUrl + h.inventoryPageURL
        }
      }

      // Scrape detail page for HOA, moveIn, schools
      let detail = { hoaFees: null, moveInDate: null, schools: null }
      if (detailUrl) {
        detail = await scrapeDetailPage(page, detailUrl)
        await page.waitForTimeout(1500) // polite delay
      } else {
        console.log(`     No detail URL — skipping page scrape`)
      }

      // Use moveIn from API if not found on detail page
      const moveInDate = detail.moveInDate || h.moveIn || null

      // Build data object
      const price = typeof h.price === "number" ? h.price : parsePriceInt(String(h.price ?? ""))
      const sqft = h.sqft ? parseInt(String(h.sqft).replace(/[^0-9]/g, ""), 10) || null : null
      const floors = h.floors ? parseInt(String(h.floors), 10) || null : null
      const garages = h.garages ? parseInt(String(h.garages), 10) || null : null
      const pricePerSqft = price && sqft ? Math.round(price / sqft) : null

      const data = {
        currentPrice: price,
        beds: typeof h.beds === "number" ? h.beds : parseFloat(h.beds) || null,
        baths: typeof h.baths === "number" ? h.baths : parseFloat(h.baths) || null,
        sqft,
        floors,
        garages,
        pricePerSqft,
        hoaFees: detail.hoaFees,
        moveInDate,
        schools: detail.schools,
        floorPlan: h.plan || null,
        lotNumber: h.lot ? String(h.lot) : null,
        status: "active",
        sourceUrl: detailUrl || comm.communityUrl,
      }

      try {
        const existing = await prisma.listing.findFirst({
          where: { communityId: community.id, address: addr },
        })

        if (existing) {
          const priceChanged = price !== null && existing.currentPrice !== price
          await prisma.listing.update({ where: { id: existing.id }, data })
          if (priceChanged) {
            await prisma.priceHistory.create({
              data: {
                listingId: existing.id,
                price,
                changeType: existing.currentPrice
                  ? price > existing.currentPrice ? "increase" : "decrease"
                  : "initial",
              },
            })
            console.log(`     ↺ Updated [${existing.id}] — price $${existing.currentPrice?.toLocaleString()} → $${price?.toLocaleString()}`)
          } else {
            console.log(`     ↺ Updated [${existing.id}] — price unchanged, details refreshed`)
          }
          console.log(`       hoaFees=${data.hoaFees} moveInDate=${data.moveInDate} schools=${data.schools?.slice(0, 60)}`)
          totalUpdated++
        } else {
          const created = await prisma.listing.create({
            data: { communityId: community.id, address: addr, ...data },
          })
          if (price) {
            await prisma.priceHistory.create({
              data: { listingId: created.id, price, changeType: "initial" },
            })
          }
          console.log(`     ✓ Created [${created.id}] ${addr} $${price?.toLocaleString()}`)
          console.log(`       hoaFees=${data.hoaFees} moveInDate=${data.moveInDate} schools=${data.schools?.slice(0, 60)}`)
          totalCreated++
        }
      } catch (e) {
        console.log(`     Error upserting: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── 4. Mark no-longer-active listings as removed ─────────
    for (const dbL of activeDbListings) {
      if (!foundAddresses.has(dbL.address)) {
        await prisma.listing.update({
          where: { id: dbL.id },
          data: { status: "removed", soldAt: new Date() },
        })
        console.log(`\n  ✗ Marked removed [${dbL.id}] "${dbL.address}" (not in API response)`)
        totalRemoved++
      }
    }
  }

  await browser.close()

  // ── Final DB state ─────────────────────────────────────────
  console.log("\n" + "=".repeat(60))
  console.log("FINAL DB STATE — Del Webb listings")
  console.log("=".repeat(60))

  for (const comm of COMMUNITIES) {
    const dbComm = await prisma.community.findUnique({ where: { id: comm.dbId } })
    if (!dbComm) continue

    const listings = await prisma.listing.findMany({
      where: { communityId: comm.dbId },
      orderBy: [{ status: "asc" }, { currentPrice: "asc" }],
    })

    console.log(`\n${comm.name} [id=${comm.dbId}]`)
    for (const l of listings) {
      const price = l.currentPrice != null ? `$${l.currentPrice.toLocaleString()}` : "N/A"
      console.log(
        `  [${l.id}] ${l.address} | plan=${l.floorPlan ?? "-"} | lot=${l.lotNumber ?? "-"} | ${price} | ${l.beds ?? "?"}bd ${l.baths ?? "?"}ba ${l.sqft ?? "?"}sqft | garages=${l.garages ?? "?"} | hoa=${l.hoaFees ?? "?"} | moveIn=${l.moveInDate ?? "?"} | status=${l.status}`
      )
      if (l.schools) console.log(`      schools: ${l.schools.slice(0, 100)}`)
    }
  }

  console.log(`\n${"─".repeat(50)}`)
  console.log(`Created: ${totalCreated}  Updated: ${totalUpdated}  Removed: ${totalRemoved}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("Fatal:", e)
  prisma.$disconnect()
  process.exit(1)
})
