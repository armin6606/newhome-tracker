/**
 * aneeq-graphql.mjs
 *
 * GraphQL-based scraper for "Aneeq" — a Lennar community clone that hits
 * Lennar's own GraphQL API directly (no browser, no AI extraction).
 *
 * Benchmark: compare Aneeq (GraphQL), Lennar (main scraper), and
 * Mennar (Firecrawl AI) to measure accuracy and completeness.
 *
 * Based on the Python scraper by the external developer:
 *   armin-us-listing-scrapper-main/lennar/
 *
 * Schedule: 11 PM PDT nightly via daily-scrape.yml
 * Run locally: node scripts/scrapers/aneeq-graphql.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, "../../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

// ── Constants ─────────────────────────────────────────────────────────────────

const BUILDER_NAME   = "Aneeq"
const GRAPHQL_URL    = "https://www.lennar.com/api/graphql"
const INGEST_URL     = "https://www.newkey.us/api/ingest"
const INGEST_SECRET  = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
const RESULTS_FILE   = "/tmp/scrape-results.json"
const COMMUNITY_DELAY = 500  // ms between communities (polite rate limit)

const GRAPHQL_HEADERS = {
  "accept":           "*/*",
  "accept-language":  "en-US,en;q=0.9",
  "content-type":     "application/json",
  "origin":           "https://www.lennar.com",
  "referer":          "https://www.lennar.com",
  "sc_apikey":        "undefined",
  "user-agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}

// ── GraphQL payloads ──────────────────────────────────────────────────────────

// Exact query from the Python developer's scraper (preserving all fragments)
const GQL_GET_MARKETS = {
  operationName: "GlobalPageQuery",
  variables: { includeMapBrowseMarketFields: false },
  query: "query GlobalPageQuery($includeMapBrowseMarketFields: Boolean = false) {\n  ...StateList\n}\n\nfragment StateList on Query {\n  states {\n    ...State\n    __typename\n  }\n  __typename\n}\n\nfragment State on StateType {\n  ...StateInfo\n  markets {\n    ...Market\n    ...MarketMapBrowseFields @include(if: $includeMapBrowseMarketFields)\n    __typename\n  }\n  __typename\n}\n\nfragment Market on MarketType {\n  id\n  code\n  name\n  slug\n  nationalPromo {\n    url\n    target\n    __typename\n  }\n  mapBounds\n  __typename\n}\n\nfragment MarketMapBrowseFields on MarketType {\n  planCount\n  latitude\n  longitude\n  __typename\n}\n\nfragment StateInfo on StateType {\n  code\n  name\n  id\n  slug\n  __typename\n}\n",
}

const GQL_NEARBY_COMMUNITIES = (mc) => ({
  operationName: "NearbyCommunities",
  variables: { mc },
  query: `query NearbyCommunities($mc: String!) {
  communitiesByMarket(mc: $mc) {
    communities {
      id name number url status customPriceV2 address zipCode
      city { name __typename }
      mpc { id mpcid name url __typename }
      __typename
    }
    __typename
  }
}`,
})

const GQL_MASTER_PLAN = (mpcid) => ({
  operationName: "MasterPlannedCommunityQuery",
  variables: { mpcid },
  query: `query MasterPlannedCommunityQuery($mpcid: Int!) {
  mpc(mpcid: $mpcid) {
    id mpcid
    communities {
      id url name hoaFee taxRate types
      plans {
        id name beds baths halfBaths sqft customPrice startingPrice
        availableHomesitesCount status url isNextGen __typename
      }
      availabilityMap {
        homesites {
          id lotid number status price wasPrice sqft beds baths halfBaths
          address lotSize url isHotw soldDate
          plan { id name url __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`,
})

const GQL_COMMUNITY_QUERY = (comnum) => ({
  operationName: "CommunityQuery",
  variables: { comnum },
  query: `query CommunityQuery($comnum: String!) {
  community(comnum: $comnum) {
    id name number url status customPriceV2 hoaFee taxRate types
    city { name __typename }
    mpc { id mpcid name url __typename }
    plans {
      id name beds baths halfBaths sqft customPrice startingPrice
      availableHomesitesCount status url isNextGen __typename
    }
    availabilityMap {
      homesites {
        id lotid number status price wasPrice sqft beds baths halfBaths
        address lotSize url isHotw soldDate
        plan { id name url __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}`,
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function gql(payload) {
  const res = await fetch(GRAPHQL_URL, {
    method:  "POST",
    headers: GRAPHQL_HEADERS,
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors[0])}`)
  return body.data
}

function normalizeAddress(addr) {
  if (!addr) return null
  return addr
    .replace(/\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim() || null
}

function mapStatus(apiStatus) {
  if (!apiStatus) return "future"
  const s = apiStatus.toUpperCase()
  // Active / purchasable lots
  if (["AVAILABLE", "QMI", "OPEN", "MOVE_IN_READY"].includes(s)) return "for sale"
  // Sold / closed lots
  if (["SOLD", "CLOSED"].includes(s))                              return "sold"
  // UNDEFINED, UNDER_CONSTRUCTION, MODEL_HOME, FUTURE_RELEASE, COMING_SOON, HOLD, etc.
  return "future"
}

// ── Market index (cached) ─────────────────────────────────────────────────────

let _marketIndex = null

async function getMarketIndex() {
  if (_marketIndex) return _marketIndex
  const data   = await gql(GQL_GET_MARKETS)
  _marketIndex = new Map()
  for (const state of data.states ?? []) {
    const stateSlug = (state.slug || state.code || "").toLowerCase()
    for (const market of state.markets ?? []) {
      const marketSlug = (market.slug || "").toLowerCase()
      if (stateSlug && marketSlug && market.code) {
        _marketIndex.set(`${stateSlug}/${marketSlug}`, market.code)
      }
    }
  }
  console.log(`  Market index loaded: ${_marketIndex.size} markets`)
  return _marketIndex
}

// ── Extract URL parts ─────────────────────────────────────────────────────────

function parseUrl(url) {
  // https://www.lennar.com/new-homes/{state}/{market}/{city}/{...}
  const parts = url.replace("https://www.lennar.com", "").split("/").filter(Boolean)
  // parts[0] = "new-homes", parts[1] = state, parts[2] = market, parts[3] = city, ...
  return {
    state:  (parts[1] || "").toLowerCase(),
    market: (parts[2] || "").toLowerCase(),
    path:   "/" + parts.join("/"),
  }
}

// ── Fetch homesite data for a community URL ───────────────────────────────────

async function fetchHomesiteData(communityUrl) {
  const { state, market, path } = parseUrl(communityUrl)
  const marketKey = `${state}/${market}`

  const marketIndex = await getMarketIndex()
  const marketCode  = marketIndex.get(marketKey)

  if (!marketCode) {
    throw new Error(`No market code for "${marketKey}"`)
  }

  // Get all communities in this market
  const marketData  = await gql(GQL_NEARBY_COMMUNITIES(marketCode))
  const communities = marketData?.communitiesByMarket?.communities ?? []

  // Match this community by URL
  const matched = communities.find(c => (c.url || "").replace(/\/$/, "") === path.replace(/\/$/, ""))
  if (!matched) {
    throw new Error(`Community not matched for "${communityUrl}" in market ${marketCode}`)
  }

  const mpcid      = matched.mpc?.mpcid ?? null
  const communNum  = String(matched.number || "")
  const communityId = matched.id

  let homesites = [], plans = [], hoaFee = null, taxRate = null, propertyType = null

  if (mpcid) {
    // Primary path: master plan
    const mpcData = await gql(GQL_MASTER_PLAN(mpcid))
    const mpCommunities = mpcData?.mpc?.communities ?? []
    const target = mpCommunities.find(c => (c.url || "").replace(/\/$/, "") === path.replace(/\/$/, ""))
    if (target) {
      homesites = target.availabilityMap?.homesites ?? []
      plans     = target.plans ?? []
      hoaFee    = target.hoaFee ?? null
      taxRate   = target.taxRate ?? null
      const types = target.types ?? []
      propertyType = types.length > 0 ? types[0] : null
    }
  } else if (communNum) {
    // Fallback path: direct community query
    const commData = await gql(GQL_COMMUNITY_QUERY(communNum))
    const comm     = commData?.community
    if (comm) {
      homesites    = comm.availabilityMap?.homesites ?? []
      plans        = comm.plans ?? []
      hoaFee       = comm.hoaFee ?? null
      taxRate      = comm.taxRate ?? null
      const types  = comm.types ?? []
      propertyType = types.length > 0 ? types[0] : null
    }
  }

  return { homesites, plans, hoaFee, taxRate, propertyType, communityId, mpcid, marketCode }
}

// ── Map homesite → ingest listing ────────────────────────────────────────────

function mapHomesite(h) {
  const status  = mapStatus(h.status)
  const address = normalizeAddress(h.address)

  // Need an address to ingest
  if (!address) return null

  const price      = (status === "for sale" && h.price && h.price > 0) ? h.price : null
  const baths      = (h.baths ?? 0) + (h.halfBaths ?? 0) * 0.5
  const pricePerSqft = price && h.sqft ? Math.round(price / h.sqft) : null

  return {
    address,
    lotNumber:    h.number ? String(h.number) : null,
    floorPlan:    h.plan?.name ?? null,
    currentPrice: price,
    pricePerSqft,
    sqft:         h.sqft   ?? null,
    beds:         h.beds   ?? null,
    baths:        baths    || null,
    status,
    sourceUrl:    h.url    ? `https://www.lennar.com${h.url}` : null,
    soldAt:       (status === "sold" && h.soldDate) ? h.soldDate : null,
  }
}

// ── Upsert listings via ingest API ────────────────────────────────────────────

async function ingestCommunity(community, listings) {
  const payload = {
    builder: {
      name:       BUILDER_NAME,
      websiteUrl: "https://www.lennar.com",
    },
    community: {
      name:  community.name,
      city:  community.city,
      state: community.state,
      url:   community.url,
    },
    listings,
  }

  const res = await fetch(INGEST_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": INGEST_SECRET },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(30_000),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log(`\n╔════════════════════════════════════╗`)
  console.log(`║   Aneeq (Lennar GraphQL) Scraper   ║`)
  console.log(`╚════════════════════════════════════╝\n`)

  const builder = await prisma.builder.findFirst({ where: { name: BUILDER_NAME } })
  if (!builder) {
    console.error(`${BUILDER_NAME} builder not found — run: npx tsx scripts/setup-aneeq.ts`)
    process.exit(1)
  }

  const communities = await prisma.community.findMany({
    where:   { builderId: builder.id },
    orderBy: { name: "asc" },
  })
  console.log(`Found ${communities.length} ${BUILDER_NAME} communities\n`)

  // Pre-load market index once
  console.log("Loading Lennar market index...")
  await getMarketIndex()

  const summary = { total: 0, forSale: 0, sold: 0, future: 0, created: 0, updated: 0, errors: [] }

  for (let i = 0; i < communities.length; i++) {
    const community = communities[i]
    console.log(`\n[${i + 1}/${communities.length}] ${community.name}`)
    console.log(`  URL: ${community.url}`)

    try {
      const { homesites, hoaFee, taxRate, propertyType } = await fetchHomesiteData(community.url)

      const statusCounts = {}
      for (const h of homesites) {
        const s = h.status || "UNKNOWN"
        statusCounts[s] = (statusCounts[s] || 0) + 1
      }
      console.log(`  API homesites: ${homesites.length} — ${JSON.stringify(statusCounts)}`)

      // Map and filter
      const listings = homesites
        .map(h => mapHomesite(h))
        .filter(Boolean)

      const forSaleCount  = listings.filter(l => l.status === "for sale").length
      const soldCount     = listings.filter(l => l.status === "sold").length
      const futureCount   = listings.filter(l => l.status === "future").length
      console.log(`  Mapped: ${listings.length} (${forSaleCount} for sale, ${soldCount} sold, ${futureCount} future)`)

      if (listings.length === 0) {
        console.log("  No listings to ingest — skipping")
        summary.total++
        continue
      }

      const result = await ingestCommunity(community, listings)
      console.log(`  ✓ created=${result.created} updated=${result.updated} rejected=${result.rejected?.length ?? 0}`)

      summary.total++
      summary.forSale  += forSaleCount
      summary.sold     += soldCount
      summary.future   += futureCount
      summary.created  += result.created  ?? 0
      summary.updated  += result.updated  ?? 0

    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`)
      summary.errors.push({ community: community.name, error: err.message })
    }

    if (i < communities.length - 1) await sleep(COMMUNITY_DELAY)
  }

  // ── Write results file ────────────────────────────────────────────────────
  const elapsed      = Math.round((Date.now() - startTime) / 1000)
  const resultStatus = summary.errors.length === communities.length ? "failure" : "success"

  const result = {
    builder:      BUILDER_NAME,
    status:       resultStatus,
    startedAt:    new Date(startTime).toISOString(),
    finishedAt:   new Date().toISOString(),
    communities:  summary.total,
    added:        summary.created,
    priceChanges: summary.updated,
    sold:         summary.sold,
    errors:       summary.errors,
    elapsedSecs:  elapsed,
  }
  try { writeFileSync(RESULTS_FILE, JSON.stringify(result, null, 2)) } catch {}

  console.log(`\n─── Summary ────────────────────────────────`)
  console.log(`  Communities scraped: ${summary.total}/${communities.length}`)
  console.log(`  For sale:            ${summary.forSale}`)
  console.log(`  Sold:                ${summary.sold}`)
  console.log(`  Future:              ${summary.future}`)
  console.log(`  Created:             ${summary.created}`)
  console.log(`  Updated:             ${summary.updated}`)
  if (summary.errors.length > 0) {
    console.log(`  Errors (${summary.errors.length}):`)
    summary.errors.forEach(e => console.log(`    • ${e.community}: ${e.error}`))
  }
  console.log(`  Elapsed: ${elapsed}s`)
  console.log(`────────────────────────────────────────────\n`)

  await prisma.$disconnect()
  if (summary.errors.length > 0 && summary.total === 0) process.exit(1)
}

main().catch(e => {
  console.error("Fatal:", e)
  prisma.$disconnect().finally(() => process.exit(1))
})
