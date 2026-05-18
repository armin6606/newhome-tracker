/**
 * mennar-firecrawl.mjs
 *
 * Firecrawl-powered scraper for "Mennar" — a Lennar community clone used
 * as an accuracy benchmark against the standard Lennar scraper.
 *
 * Uses /v1/scrape with formats:["extract"] — synchronous, no polling,
 * 1 credit per page (vs 5 credits for the deprecated /v2/extract).
 *
 * Schedule: 11 PM PDT nightly (06:00 UTC) via .github/workflows/mennar-scrape.yml
 * Run locally: node scripts/scrapers/mennar-firecrawl.mjs
 */

import { createRequire } from "module"
import { writeFileSync }  from "fs"
import { dirname }        from "path"
import { fileURLToPath }  from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

// ── Constants ─────────────────────────────────────────────────────────────────

const BUILDER_NAME    = "Mennar"
const FIRECRAWL_BASE  = "https://api.firecrawl.dev"
const RESULTS_FILE    = "/tmp/scrape-results.json"
const COMMUNITY_DELAY = 3_000   // 3 s between communities (rate limit)
const TIMEOUT_MS      = 90_000  // 90 s per scrape request

// ── JSON extraction schema ────────────────────────────────────────────────────

const JSON_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      description: "Every home, lot, or floor plan found on the page",
      items: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Full street address of the home (e.g. '1234 Oak St'). Null if not shown.",
          },
          lotNumber: {
            type: "string",
            description: "Lot or home site number (e.g. '15', 'Lot 15'). Null if not shown.",
          },
          floorPlan: {
            type: "string",
            description: "Floor plan or model name (e.g. 'Plan 1', 'Residence 2', 'Sierra').",
          },
          price: {
            type: "number",
            description: "List price as a plain number, no $ or commas. Null if not shown.",
          },
          beds: {
            type: "integer",
            description: "Number of bedrooms.",
          },
          baths: {
            type: "number",
            description: "Number of bathrooms (e.g. 2.5 for two full + one half).",
          },
          sqft: {
            type: "integer",
            description: "Square footage as a whole number.",
          },
          status: {
            type: "string",
            enum: ["for sale", "sold", "future"],
            description: "'for sale' = available/QMI with a price. 'sold' = closed/sold. 'future' = coming soon or no price.",
          },
          moveInDate: {
            type: "string",
            description: "Estimated move-in or delivery date as text (e.g. 'Summer 2025', 'Oct 2025').",
          },
        },
        required: ["status"],
      },
    },
  },
  required: ["listings"],
}

const JSON_PROMPT = `
Extract ALL home listings from this Lennar new home community page.

Include EVERY home, lot, or quick move-in (QMI) shown — available/for-sale homes, sold/closed homes, and coming-soon/future release homes.

For each listing capture:
- address: full street address if shown (e.g. "1234 Maple Way"). Null if no address visible.
- lotNumber: the lot or home-site number if shown.
- floorPlan: the plan or model name (e.g. "Plan 1", "Residence 2", "Hacienda").
- price: asking price as a plain number (no $ signs). Null for sold or coming-soon homes.
- beds / baths / sqft: pull from each card or plan row.
- status: "for sale" if available with a price, "sold" if already sold/closed, "future" if no price / coming soon.
- moveInDate: move-in or completion date text if shown.

Do NOT skip floor plans listed at the bottom — they often show available lots.
`.trim()

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function apiKey() {
  const k = process.env.FIRECRAWL_API_KEY
  if (!k) throw new Error("FIRECRAWL_API_KEY env var is not set")
  return k
}

// ── Firecrawl /v2/scrape (synchronous) ────────────────────────────────────────

async function scrapeListings(url) {
  const res = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      url,
      formats:         ["extract"],
      extract: {
        schema: JSON_SCHEMA,
        prompt: JSON_PROMPT,
      },
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const body = await res.json()
  if (!res.ok || !body.success) {
    throw new Error(`Firecrawl scrape failed (${res.status}): ${JSON.stringify(body)}`)
  }

  return body.data?.extract?.listings ?? []
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normalizeAddress(addr) {
  return (addr ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function mapListing(raw, communityName, communityUrl) {
  const status = ["for sale", "sold", "future"].includes(raw.status) ? raw.status : "future"
  const price  = typeof raw.price === "number" && raw.price > 0 ? raw.price : null

  let address = (raw.address ?? "").trim()
  if (!address && raw.lotNumber) address = `Lot ${raw.lotNumber}`
  if (!address && raw.floorPlan) address = `Plan ${raw.floorPlan}`
  if (!address) return null

  return {
    communityName,
    communityUrl,
    address,
    lotNumber:    raw.lotNumber  ?? null,
    floorPlan:    raw.floorPlan  ?? null,
    sqft:         raw.sqft       ?? null,
    beds:         raw.beds       ?? null,
    baths:        raw.baths      ?? null,
    price:        status === "for sale" ? price : null,
    pricePerSqft: status === "for sale" && price && raw.sqft ? Math.round(price / raw.sqft) : null,
    status,
    moveInDate:   raw.moveInDate ?? null,
    sourceUrl:    communityUrl,
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertListings(communityId, scrapedListings) {
  const stats = { added: 0, priceChanges: 0, sold: 0, unchanged: 0 }

  const existing = await prisma.listing.findMany({
    where: { communityId, status: { not: "removed" } },
  })
  const byAddress = new Map(existing.map(l => [normalizeAddress(l.address), l]))
  const byLotNum  = new Map(existing.filter(l => l.lotNumber).map(l => [l.lotNumber, l]))
  const scrapedSet = new Set(scrapedListings.map(l => normalizeAddress(l.address)))

  for (const s of scrapedListings) {
    const key = normalizeAddress(s.address)
    const ex  = byAddress.get(key) ?? (s.lotNumber ? byLotNum.get(s.lotNumber) : undefined)

    if (!ex) {
      await prisma.listing.upsert({
        where:  { communityId_address: { communityId, address: s.address } },
        create: {
          communityId,
          address:      s.address,
          lotNumber:    s.lotNumber,
          floorPlan:    s.floorPlan,
          sqft:         s.sqft,
          beds:         s.beds,
          baths:        s.baths,
          currentPrice: s.price,
          pricePerSqft: s.pricePerSqft,
          moveInDate:   s.moveInDate,
          sourceUrl:    s.sourceUrl,
          status:       s.status,
          soldAt:       s.status === "sold" ? new Date() : null,
        },
        update: { status: s.status },
      }).catch(() => {})
      stats.added++

    } else if (ex.status !== s.status || ex.currentPrice !== s.price) {
      const data = { status: s.status, currentPrice: s.price, pricePerSqft: s.pricePerSqft }
      if (s.status === "sold" && ex.status !== "sold") data.soldAt = new Date()
      await prisma.listing.update({ where: { id: ex.id }, data })
      if (ex.currentPrice !== s.price && s.price !== null) stats.priceChanges++
      if (s.status === "sold" && ex.status !== "sold")     stats.sold++
    } else {
      stats.unchanged++
    }
  }

  // Mark listings no longer visible as sold
  for (const [key, ex] of byAddress.entries()) {
    if (scrapedSet.has(key)) continue
    if (ex.status !== "for sale") continue
    if (ex.currentPrice == null) continue
    await prisma.listing.update({ where: { id: ex.id }, data: { status: "sold", soldAt: new Date() } })
    stats.sold++
  }

  await prisma.community.update({ where: { id: communityId }, data: { lastScrapedAt: new Date() } })
  return stats
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log(`\n╔═══════════════════════════════╗`)
  console.log(`║   Mennar (Firecrawl) Scraper  ║`)
  console.log(`╚═══════════════════════════════╝\n`)

  const builder = await prisma.builder.findFirst({ where: { name: BUILDER_NAME } })
  if (!builder) {
    console.error("Mennar builder not found — run: npx tsx scripts/setup-mennar.ts")
    process.exit(1)
  }

  const communities = await prisma.community.findMany({
    where:   { builderId: builder.id },
    orderBy: { name: "asc" },
  })
  console.log(`Found ${communities.length} Mennar communities\n`)

  const summary = { total: 0, added: 0, priceChanges: 0, sold: 0, errors: [] }

  for (let i = 0; i < communities.length; i++) {
    const community = communities[i]
    console.log(`[${i + 1}/${communities.length}] ${community.name}`)
    console.log(`    URL: ${community.url}`)

    try {
      const rawListings = await scrapeListings(community.url)
      console.log(`    → ${rawListings.length} raw items extracted`)

      const mapped = rawListings.map(r => mapListing(r, community.name, community.url)).filter(Boolean)
      console.log(`    → ${mapped.length} valid listings mapped`)

      const stats = await upsertListings(community.id, mapped)
      console.log(`    → +${stats.added} new | ${stats.priceChanges} price changes | ${stats.sold} sold | ${stats.unchanged} unchanged`)

      summary.total++
      summary.added        += stats.added
      summary.priceChanges += stats.priceChanges
      summary.sold         += stats.sold

    } catch (err) {
      console.error(`    ✗ Error: ${err.message}`)
      summary.errors.push({ community: community.name, error: err.message })
    }

    if (i < communities.length - 1) await sleep(COMMUNITY_DELAY)
  }

  // ── Write results ─────────────────────────────────────────────────────────
  const elapsed      = Math.round((Date.now() - startTime) / 1000)
  const resultStatus = summary.errors.length === communities.length ? "failure" : "success"

  const result = {
    builder:      BUILDER_NAME,
    status:       resultStatus,
    startedAt:    new Date(startTime).toISOString(),
    finishedAt:   new Date().toISOString(),
    communities:  summary.total,
    added:        summary.added,
    priceChanges: summary.priceChanges,
    sold:         summary.sold,
    errors:       summary.errors,
    elapsedSecs:  elapsed,
  }

  try { writeFileSync(RESULTS_FILE, JSON.stringify(result, null, 2)) } catch {}

  console.log(`\n─── Summary ───────────────────────────`)
  console.log(`  Communities: ${summary.total}/${communities.length}`)
  console.log(`  New listings:    ${summary.added}`)
  console.log(`  Price changes:   ${summary.priceChanges}`)
  console.log(`  Newly sold:      ${summary.sold}`)
  if (summary.errors.length > 0) {
    console.log(`  Errors (${summary.errors.length}):`)
    summary.errors.forEach(e => console.log(`    • ${e.community}: ${e.error}`))
  }
  console.log(`  Elapsed: ${elapsed}s`)
  console.log(`───────────────────────────────────────\n`)

  await prisma.$disconnect()
  if (summary.errors.length > 0 && summary.total === 0) process.exit(1)
}

main().catch(e => {
  console.error("Fatal:", e)
  prisma.$disconnect().finally(() => process.exit(1))
})
