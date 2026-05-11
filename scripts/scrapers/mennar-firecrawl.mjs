/**
 * mennar-firecrawl.mjs
 *
 * Firecrawl-powered scraper for "Mennar" — a Lennar community clone used
 * as an accuracy benchmark against the standard Lennar scraper.
 *
 * Flow per community:
 *   1. POST /v2/extract to Firecrawl with community URL + schema
 *   2. Poll GET /v2/extract/{id} until completed / failed
 *   3. Map extracted listings to DB format
 *   4. Upsert via Prisma (same detect-changes logic as other scrapers)
 *
 * Schedule: 11 PM PDT nightly (06:00 UTC) via .github/workflows/mennar-scrape.yml
 * Run locally: node scripts/scrapers/mennar-firecrawl.mjs
 */

import { createRequire }            from "module"
import { writeFileSync }            from "fs"
import { dirname }                  from "path"
import { fileURLToPath }            from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

// ── Constants ─────────────────────────────────────────────────────────────────

const BUILDER_NAME     = "Mennar"
const FIRECRAWL_BASE   = "https://api.firecrawl.dev"
const RESULTS_FILE     = "/tmp/scrape-results.json"
const POLL_INTERVAL_MS = 5_000   // 5 s between polls
const POLL_MAX_TRIES   = 60      // up to 5 min per community
const COMMUNITY_DELAY  = 8_000   // 8 s between communities (rate limit)

// ── Firecrawl extraction schema ───────────────────────────────────────────────

const EXTRACT_SCHEMA = {
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
            description: "Full street address of the home (e.g. '1234 Oak St'). Use null if not shown.",
          },
          lotNumber: {
            type: "string",
            description: "Lot or home site number (e.g. '15', 'Lot 15'). Use null if not shown.",
          },
          floorPlan: {
            type: "string",
            description: "Floor plan or model name (e.g. 'Plan 1', 'Residence 2', 'Sierra').",
          },
          price: {
            type: "number",
            description: "List price as a plain number with no $ or commas. Null if not shown.",
          },
          beds: {
            type: "integer",
            description: "Number of bedrooms.",
          },
          baths: {
            type: "number",
            description: "Number of bathrooms. Use 2.5 for two full + one half bath.",
          },
          sqft: {
            type: "integer",
            description: "Square footage as a whole number.",
          },
          status: {
            type: "string",
            enum: ["for sale", "sold", "future"],
            description: "'for sale' = available/QMI with a price. 'sold' = closed/sold. 'future' = coming soon or no price shown.",
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

const EXTRACT_PROMPT = `
You are extracting all home listings from a Lennar new home community page.

Extract EVERY home, lot, or quick move-in (QMI) opportunity shown on the page — both available/for-sale homes AND sold/closed homes if displayed. Include any "coming soon" or future release homes.

For each listing capture:
- address: the full street address if shown (e.g. "1234 Maple Way"). Omit if no address is visible.
- lotNumber: the lot or home-site number if shown.
- floorPlan: the plan or model name (e.g. "Plan 1", "Residence 2", "Hacienda").
- price: the asking price as a plain number (no $ signs). Leave null for sold or coming-soon homes.
- beds / baths / sqft: pull from each card or plan row.
- status: "for sale" if available with a price, "sold" if already sold/closed, "future" if no price / coming soon.
- moveInDate: move-in or completion date text if shown.

Do NOT skip floor plans listed at the bottom of the page — they often show available lots.
`.trim()

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function apiKey() {
  const k = process.env.FIRECRAWL_API_KEY
  if (!k) throw new Error("FIRECRAWL_API_KEY env var is not set")
  return k
}

// ── Firecrawl API calls ───────────────────────────────────────────────────────

/**
 * Submit an extraction job and return the job ID.
 */
async function submitExtract(url) {
  const res = await fetch(`${FIRECRAWL_BASE}/v2/extract`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      urls:   [url],
      prompt: EXTRACT_PROMPT,
      schema: EXTRACT_SCHEMA,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const body = await res.json()
  if (!res.ok || !body.success) {
    throw new Error(`Firecrawl submit failed (${res.status}): ${JSON.stringify(body)}`)
  }
  return body.id
}

/**
 * Poll GET /v2/extract/{id} until completed or failed.
 * Returns the raw `data` object on success.
 */
async function pollExtract(jobId) {
  for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    const res = await fetch(`${FIRECRAWL_BASE}/v2/extract/${jobId}`, {
      headers: { "Authorization": `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(15_000),
    })
    const body = await res.json()

    if (body.status === "completed") return body.data
    if (body.status === "failed")    throw new Error(`Firecrawl job failed: ${body.error ?? "unknown"}`)

    // still "processing" or "pending" — keep polling
    process.stdout.write(".")
  }
  throw new Error(`Firecrawl job ${jobId} timed out after ${POLL_MAX_TRIES * POLL_INTERVAL_MS / 1000}s`)
}

/**
 * Full extract for one URL: submit + poll.
 * Returns array of raw listing objects from Firecrawl.
 */
async function extractListings(url) {
  console.log(`    → Submitting Firecrawl job...`)
  const jobId = await submitExtract(url)
  console.log(`    → Job ${jobId} — polling`)
  process.stdout.write("    ")
  const data = await pollExtract(jobId)
  console.log(" done")
  return data?.listings ?? []
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normalizeAddress(addr) {
  return (addr ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Map a raw Firecrawl listing to the ScrapedListing shape expected by upsertListings.
 */
function mapListing(raw, communityName, communityUrl) {
  const status = ["for sale", "sold", "future"].includes(raw.status) ? raw.status : "future"
  const price  = typeof raw.price === "number" && raw.price > 0 ? raw.price : null

  // Build a stable address — prefer street address, fall back to lot/plan label
  let address = (raw.address ?? "").trim()
  if (!address && raw.lotNumber) address = `Lot ${raw.lotNumber}`
  if (!address && raw.floorPlan) address = `Plan ${raw.floorPlan}`
  if (!address) return null  // nothing to key off

  return {
    communityName,
    communityUrl,
    address,
    lotNumber:    raw.lotNumber   ?? null,
    floorPlan:    raw.floorPlan   ?? null,
    sqft:         raw.sqft        ?? null,
    beds:         raw.beds        ?? null,
    baths:        raw.baths       ?? null,
    price:        status === "for sale" ? price : null,
    pricePerSqft: status === "for sale" && price && raw.sqft ? Math.round(price / raw.sqft) : null,
    status,
    moveInDate:   raw.moveInDate  ?? null,
    sourceUrl:    communityUrl,
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

/**
 * Upsert scraped listings for one community and return change counts.
 * Mirrors the logic in lib/scraper/detect-changes.ts but written inline
 * (no dependency on the TS lib at runtime for this .mjs file).
 */
async function upsertListings(communityId, scrapedListings) {
  const stats = { added: 0, priceChanges: 0, sold: 0, unchanged: 0 }

  // Existing active listings
  const existing = await prisma.listing.findMany({
    where: { communityId, status: { not: "removed" } },
  })
  const byAddress = new Map(existing.map((l) => [normalizeAddress(l.address), l]))
  const byLotNum  = new Map(
    existing.filter((l) => l.lotNumber).map((l) => [l.lotNumber, l])
  )
  const scrapedSet = new Set(scrapedListings.map((l) => normalizeAddress(l.address)))

  for (const s of scrapedListings) {
    const key = normalizeAddress(s.address)
    const ex  = byAddress.get(key) ?? (s.lotNumber ? byLotNum.get(s.lotNumber) : undefined)

    if (!ex) {
      // New listing
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
      // Status or price change
      const data = {
        status:       s.status,
        currentPrice: s.price,
        pricePerSqft: s.pricePerSqft,
      }
      if (s.status === "sold" && ex.status !== "sold") {
        data.soldAt = new Date()
      }
      await prisma.listing.update({ where: { id: ex.id }, data })
      if (ex.currentPrice !== s.price && s.price !== null) stats.priceChanges++
      if (s.status === "sold" && ex.status !== "sold")      stats.sold++

    } else {
      stats.unchanged++
    }
  }

  // Mark no-longer-visible active homes as sold
  for (const [key, ex] of byAddress.entries()) {
    if (scrapedSet.has(key)) continue
    if (ex.status !== "for sale") continue
    if (ex.currentPrice == null)  continue  // was future, not really sold

    await prisma.listing.update({
      where: { id: ex.id },
      data:  { status: "sold", soldAt: new Date() },
    })
    stats.sold++
  }

  await prisma.community.update({
    where: { id: communityId },
    data:  { lastScrapedAt: new Date() },
  })

  return stats
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log(`\n╔═══════════════════════════════╗`)
  console.log(`║   Mennar (Firecrawl) Scraper  ║`)
  console.log(`╚═══════════════════════════════╝\n`)

  // Find Mennar builder
  const builder = await prisma.builder.findFirst({ where: { name: BUILDER_NAME } })
  if (!builder) {
    console.error("Mennar builder not found — run: npx tsx scripts/setup-mennar.ts")
    process.exit(1)
  }

  // Load all Mennar communities
  const communities = await prisma.community.findMany({
    where: { builderId: builder.id },
    orderBy: { name: "asc" },
  })
  console.log(`Found ${communities.length} Mennar communities\n`)

  const summary = { total: 0, added: 0, priceChanges: 0, sold: 0, errors: [] }

  for (let i = 0; i < communities.length; i++) {
    const community = communities[i]
    console.log(`[${i + 1}/${communities.length}] ${community.name}`)
    console.log(`    URL: ${community.url}`)

    try {
      // Extract from Firecrawl
      const rawListings = await extractListings(community.url)
      console.log(`    → ${rawListings.length} raw items extracted`)

      // Map to ScrapedListing
      const mapped = rawListings
        .map((r) => mapListing(r, community.name, community.url))
        .filter(Boolean)
      console.log(`    → ${mapped.length} valid listings mapped`)

      // Upsert to DB
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

    // Polite delay between communities
    if (i < communities.length - 1) {
      await sleep(COMMUNITY_DELAY)
    }
  }

  // ── Write results file ────────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000)
  const resultStatus = summary.errors.length === communities.length ? "failure" : "success"

  const result = {
    builder:     BUILDER_NAME,
    status:      resultStatus,
    startedAt:   new Date(startTime).toISOString(),
    finishedAt:  new Date().toISOString(),
    communities: summary.total,
    added:       summary.added,
    priceChanges:summary.priceChanges,
    sold:        summary.sold,
    errors:      summary.errors,
    elapsedSecs: elapsed,
  }

  try {
    writeFileSync(RESULTS_FILE, JSON.stringify(result, null, 2))
    console.log(`\nResults written to ${RESULTS_FILE}`)
  } catch {
    // Non-fatal — CI artifact upload may fail outside GitHub Actions
  }

  console.log(`\n─── Summary ───────────────────────────`)
  console.log(`  Communities: ${summary.total}/${communities.length}`)
  console.log(`  New listings:    ${summary.added}`)
  console.log(`  Price changes:   ${summary.priceChanges}`)
  console.log(`  Newly sold:      ${summary.sold}`)
  if (summary.errors.length > 0) {
    console.log(`  Errors (${summary.errors.length}):`)
    summary.errors.forEach((e) => console.log(`    • ${e.community}: ${e.error}`))
  }
  console.log(`  Elapsed: ${elapsed}s`)
  console.log(`───────────────────────────────────────\n`)

  await prisma.$disconnect()

  if (summary.errors.length > 0 && summary.total === 0) process.exit(1)
}

main().catch((e) => {
  console.error("Fatal:", e)
  prisma.$disconnect().finally(() => process.exit(1))
})
