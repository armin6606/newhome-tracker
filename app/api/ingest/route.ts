import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { BUILDER_SHEET_TABS, getSheetCommunities } from "@/lib/sheet-validator"
import { normalizeBuilderName, normalizeCommunityName } from "@/lib/normalizer"
import { updateTable2, type Table2Counts } from "@/lib/sheet-writer"
import { getTable3Plans, lookupPlan, matchPlanBySpecs, normalizePlan } from "@/lib/table3-reader"

/**
 * POST /api/ingest
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  TABLE 3 RULE — IMMUTABLE, NEVER REMOVE:
 *
 *  beds / sqft / baths / floors / propertyType / hoaFees / taxes
 *  come EXCLUSIVELY from Table 3 of the builder's Google Sheet.
 *
 *  These fields are STRIPPED from every ingest payload regardless of
 *  scraperMode, manual ingest, or any other context. The ingest route
 *  looks them up internally via lib/table3-reader.ts — scrapers and
 *  callers have no say in these values.
 *
 *  If a listing's floorplan is not found in Table 3:
 *    - The listing is still created/updated (with null for the above fields)
 *    - An email alert is sent to armin.sabe@gmail.com listing every missing plan
 *
 *  garages / moveInDate / incentives / sourceUrl → still come from payload
 *  (moveInDate: Table 3 default used only when payload provides none)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * VALIDATION RULES:
 *
 *  HARD BLOCKS (listing skipped or request rejected):
 *  0.  Builder must have a Google Sheet tab (BUILDER_SHEET_TABS map)
 *  0b. Community must exist in that sheet's Table 2
 *  1.  Builder must exist in DB — never auto-created
 *  2.  Community must exist in DB — never auto-created
 *  3.  Address must start with a street number
 *  4.  Floorplan names as addresses rejected (Plan 1, Lot 3, etc.)
 *  5.  Status must be active|sold|future|removed
 *  6.  Sold → Active reversal blocked
 *  7.  Lot number format validated
 *
 *  AUTO-FIXES (corrected silently):
 *  8.  City suffix stripped from address
 *  9.  Street suffix stripped
 *  10. Title case applied to address
 *  11. active + no price + real address → forced to future
 *  12. sold + no soldAt → soldAt auto-set to now
 *
 *  WARNINGS:
 *  13. Floorplan not found in Table 3 → email sent, listing created with nulls
 *  14. Price outside expected OC range ($200k–$15M)
 *  15. Future listing with price
 */

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(["active", "sold", "future", "removed"])
const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/
const SUFFIX_RE      = /\s+\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass|Alley)\b\.?$/i
const CITY_RE        = /,\s*.+$/
const FLOORPLAN_RE   = /^(plan\s*\d|lot\s*\d|residence\s*\d|home\s*\d|model\s*\d)/i
const PRICE_MIN      = 200_000
const PRICE_MAX      = 15_000_000
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const ALERT_EMAIL    = "armin.sabe@gmail.com"

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanAddress(raw: string): string {
  let a = raw.trim()
  a = a.replace(CITY_RE, "")
  a = a.replace(SUFFIX_RE, "")
  a = a.trim()
  a = a.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  return a
}

function communityPrefix(name: string): string {
  return name.replace(/\s+/g, "")
}

async function sendMissingPlanAlert(
  builderName:   string,
  communityName: string,
  missing:       string[],
): Promise<void> {
  if (!missing.length) return
  try {
    const listHtml = missing.map(p => `<li><strong>${p}</strong></li>`).join("")
    await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "New Key <onboarding@resend.dev>",
        to:      [ALERT_EMAIL],
        subject: `⚠️ Table 3 Missing: ${missing.length} floorplan(s) — ${communityName} (${builderName})`,
        html: `
          <h2>Table 3 — Missing Floorplans</h2>
          <p>The scraper found new homes with floorplans not yet in <strong>Table 3</strong>
          for <strong>${communityName}</strong> (${builderName}).</p>
          <p>These listings were created with <strong>null</strong> beds/sqft/baths/floors/type/HOA/tax.
          Please add the following plans to Table 3 and run
          <code>POST /api/sync-table3</code> to backfill:</p>
          <ul>${listHtml}</ul>
          <p style="color:#888;font-size:12px">Sent by New Key ingest route</p>
        `,
      }),
    })
  } catch (err) {
    console.error("[ingest] Failed to send missing-plan alert:", err)
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RawListing {
  address?:       string
  lotNumber?:     string
  floorPlan?:     string
  // NOTE: sqft/beds/baths/floors/propertyType/hoaFees/taxes are intentionally
  // accepted in the interface but ALWAYS stripped — Table 3 is the only source.
  sqft?:          number
  beds?:          number
  baths?:         number
  garages?:       number
  floors?:        number
  currentPrice?:  number
  pricePerSqft?:  number
  propertyType?:  string
  hoaFees?:       number
  taxes?:         string
  moveInDate?:    string
  incentives?:    string
  incentivesUrl?: string
  status?:        string
  sourceUrl?:     string
  soldAt?:        string
}

/**
 * Sanitize a moveInDate value.
 * Rules:
 *  - Strip whitespace and newlines
 *  - Allow: "Mon YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "Ready Now", "Quick Move-In", short phrases
 *  - Block: anything containing a bare number > 2100 (e.g. "Now\n5868"), or a number that
 *    looks like a street number / lot number (4+ digit number not part of a valid date)
 * Returns the cleaned string if valid, or null if invalid.
 */
function sanitizeMoveInDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.replace(/[\r\n\t]+/g, " ").trim()
  if (!s) return null
  // Block if contains a standalone 4+ digit number that isn't a valid year (2020-2040)
  const nums = s.match(/\b\d{4,}\b/g) ?? []
  for (const n of nums) {
    const num = parseInt(n)
    if (num < 2020 || num > 2040) return null  // looks like a lot/street number, not a date
  }
  // Block if the string is only digits (no letters or slashes)
  if (/^\d+$/.test(s)) return null
  return s
}

interface ValidationResult {
  ok:              boolean
  reason?:         string
  cleanedAddress?: string | null
  forcedStatus?:   string
  forcedSoldAt?:   Date
  warnings?:       string[]
}

// ── Per-listing validator ────────────────────────────────────────────────────

function validateListing(l: RawListing, communityName: string, existingStatus?: string): ValidationResult {
  const warnings: string[] = []
  const isPlaceholder = !!(l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber))
  const status = l.status || "active"

  if (!VALID_STATUSES.has(status)) {
    return { ok: false, reason: `Invalid status "${status}"` }
  }
  if (existingStatus === "sold" && status === "active") {
    return { ok: false, reason: `Cannot reverse sold → active` }
  }
  if (isPlaceholder) {
    return { ok: true, cleanedAddress: null }
  }
  if (l.lotNumber) {
    const prefix = communityPrefix(communityName)
    if (!l.lotNumber.startsWith(prefix)) {
      warnings.push(`lotNumber "${l.lotNumber}" should start with prefix "${prefix}"`)
    }
  }
  if (l.address) {
    if (FLOORPLAN_RE.test(l.address.trim())) {
      return { ok: false, reason: `Address "${l.address}" looks like a floorplan name` }
    }
    const cleaned = cleanAddress(l.address)
    if (!/^\d/.test(cleaned)) {
      return { ok: false, reason: `Address "${l.address}" does not start with a street number` }
    }
    const forcedStatus  = (status === "active" && !l.currentPrice) ? "future" : undefined
    const forcedSoldAt  = (status === "sold" && !l.soldAt) ? new Date() : undefined

    if (l.currentPrice) {
      if (l.currentPrice < PRICE_MIN) warnings.push(`Price $${l.currentPrice.toLocaleString()} below minimum`)
      if (l.currentPrice > PRICE_MAX) warnings.push(`Price $${l.currentPrice.toLocaleString()} exceeds maximum`)
    }
    if (status === "future" && l.currentPrice) {
      warnings.push(`Future listing has a price — verify`)
    }

    return {
      ok: true,
      cleanedAddress: cleaned,
      forcedStatus,
      forcedSoldAt,
      warnings: warnings.length ? warnings : undefined,
    }
  }

  return { ok: true, cleanedAddress: null, warnings: warnings.length ? warnings : undefined }
}

// ── Placeholder sync ────────────────────────────────────────────────────────

async function syncPlaceholders(communityId: number, counts: Table2Counts): Promise<void> {
  const existing = await prisma.listing.findMany({
    where:  { communityId, address: null },
    select: { id: true, status: true, lotNumber: true },
  })

  const activeSold   = existing.filter(l => l.status === "sold")
  const activeAvail  = existing.filter(l => l.status === "active")
  const activeFuture = existing.filter(l => l.status === "future")

  const toCreate:     { communityId: number; lotNumber: string; status: string; address: null }[] = []
  const toReactivate: { id: number; status: string }[] = []
  const toDelete:     number[] = []

  function reconcile(
    active:    { id: number; status: string; lotNumber: string | null }[],
    prefix:    string,
    needCount: number,
    newStatus: string,
  ) {
    const numOf = (l: { lotNumber: string | null }) =>
      parseInt((l.lotNumber ?? "").replace(prefix + "-", "")) || 0

    if (needCount > active.length) {
      const deficit  = needCount - active.length
      const removed  = existing
        .filter(l => l.status === "removed" && l.lotNumber?.startsWith(prefix + "-"))
        .sort((a, b) => numOf(a) - numOf(b))
      const toRevive = removed.slice(0, deficit)
      toReactivate.push(...toRevive.map(l => ({ id: l.id, status: newStatus })))
      const allOfType = existing.filter(l => l.lotNumber?.startsWith(prefix + "-"))
      const maxN      = allOfType.reduce((m, l) => Math.max(m, numOf(l)), 0)
      for (let i = toRevive.length; i < deficit; i++)
        toCreate.push({ communityId, lotNumber: `${prefix}-${maxN + (i - toRevive.length) + 1}`, status: newStatus, address: null })
    } else if (needCount < active.length) {
      toDelete.push(
        ...[...active].sort((a, b) => numOf(b) - numOf(a)).slice(0, active.length - needCount).map(l => l.id)
      )
    }
  }

  reconcile(activeSold,   "sold",   counts.sold,    "sold")
  reconcile(activeAvail,  "avail",  counts.forSale, "active")
  reconcile(activeFuture, "future", counts.future,  "future")

  if (toDelete.length > 0) {
    await prisma.priceHistory.deleteMany({ where: { listingId: { in: toDelete } } })
    await prisma.listing.deleteMany({ where: { id: { in: toDelete } } })
  }
  if (toReactivate.length > 0) {
    const byStat = new Map<string, number[]>()
    for (const { id, status } of toReactivate) {
      if (!byStat.has(status)) byStat.set(status, [])
      byStat.get(status)!.push(id)
    }
    for (const [status, ids] of byStat)
      await prisma.listing.updateMany({ where: { id: { in: ids } }, data: { status } })
  }
  if (toCreate.length > 0) {
    await prisma.listing.createMany({ data: toCreate, skipDuplicates: true })
  }

  if (toDelete.length + toReactivate.length + toCreate.length > 0) {
    console.log(
      `[ingest] placeholder sync community ${communityId}: ` +
      `+${toReactivate.length} reactivated, +${toCreate.length} created, -${toDelete.length} removed`,
    )
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ingest-secret")
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 })
  }
  const { builder: builderData, community: communityData, listings: listingsData, scraperMode } = body

  if (!builderData?.name || !communityData?.name || !Array.isArray(listingsData)) {
    return NextResponse.json({ error: "Invalid payload. Required: builder, community, listings[]" }, { status: 400 })
  }

  // Guardrail: cap payload size to prevent memory exhaustion / Vercel timeout
  if (listingsData.length > 500) {
    return NextResponse.json({
      error: `Payload too large: ${listingsData.length} listings. Maximum 500 per request.`,
    }, { status: 400 })
  }

  // ── Normalize builder + community names to canonical Sheet names ─────────
  const rawBuilderName    = builderData.name as string
  const rawCommunityName  = communityData.name as string

  const canonicalBuilder = normalizeBuilderName(rawBuilderName)
  if (!canonicalBuilder) {
    return NextResponse.json({
      error: `Builder "${rawBuilderName}" could not be matched to any known builder. Allowed: ${Object.keys(BUILDER_SHEET_TABS).join(", ")}`,
    }, { status: 400 })
  }
  if (canonicalBuilder !== rawBuilderName) {
    console.log(`[ingest] Builder normalized: "${rawBuilderName}" → "${canonicalBuilder}"`)
    builderData.name = canonicalBuilder
  }

  const canonicalCommunity = await normalizeCommunityName(rawCommunityName, canonicalBuilder)
  if (!canonicalCommunity) {
    const sheetList = await getSheetCommunities(canonicalBuilder)
    return NextResponse.json({
      error: `Community "${rawCommunityName}" could not be matched to any known community for "${canonicalBuilder}".`,
      knownSheetCommunities: sheetList ? [...sheetList] : [],
    }, { status: 400 })
  }
  if (canonicalCommunity !== rawCommunityName) {
    console.log(`[ingest] Community normalized: "${rawCommunityName}" → "${canonicalCommunity}"`)
    communityData.name = canonicalCommunity
  }

  // ── Sheet validator ───────────────────────────────────────────────────────
  const sheetCommunities = await getSheetCommunities(canonicalBuilder)
  if (!sheetCommunities) {
    return NextResponse.json({
      error: `Cannot fetch Google Sheet for "${canonicalBuilder}". Ingest blocked.`,
    }, { status: 400 })
  }

  // ── Rule 1: Builder must exist ────────────────────────────────────────────
  const existingBuilder = await prisma.builder.findUnique({ where: { name: builderData.name } })
  if (!existingBuilder) {
    return NextResponse.json({
      error: `Builder "${builderData.name}" does not exist. Create it manually.`,
    }, { status: 400 })
  }

  // ── Rule 2: Community must exist ──────────────────────────────────────────
  const existingCommunity = await prisma.community.findUnique({
    where: { builderId_name: { builderId: existingBuilder.id, name: communityData.name } },
  })
  if (!existingCommunity) {
    const known = await prisma.community.findMany({
      where: { builderId: existingBuilder.id }, select: { name: true },
    })
    return NextResponse.json({
      error: `Community "${communityData.name}" does not exist for "${builderData.name}".`,
      knownCommunities: known.map(c => c.name),
    }, { status: 400 })
  }

  if (communityData.url) {
    await prisma.community.update({
      where: { id: existingCommunity.id },
      data: {
        ...(communityData.city && communityData.city !== "Irvine" ? { city: communityData.city } : {}),
        state:    communityData.state || "CA",
        url:      communityData.url,
      },
    })
  }

  const community = existingCommunity

  // Note: placeholder reconciliation is handled automatically by syncPlaceholders() below.

  // ── Load Table 3 for this builder (READ-ONLY floorplan data) ─────────────
  // RULE: beds/sqft/baths/floors/propertyType/hoaFees/taxes come ONLY from here.
  // The ingest payload values for those fields are always stripped and ignored.
  const table3Plans   = await getTable3Plans(existingBuilder.name)
  const missingPlans  = new Set<string>() // floorplan names not yet in Table 3

  const results    = { created: 0, updated: 0, priceChanges: 0, table3Filled: 0 }
  const rejected:  { address?: string; lotNumber?: string; reason: string }[]    = []
  const autoFixed: { address?: string; lotNumber?: string; fix: string }[]        = []
  const warnings:  { address?: string; lotNumber?: string; issues: string[] }[]   = []

  let sheetDelta = { sold: 0, forSale: 0 }

  // ── Pre-fetch all existing listings for this community (1 query replaces N findUnique calls) ──
  const allExisting = await prisma.listing.findMany({ where: { communityId: community.id } })
  const existingByAddress   = new Map(allExisting.filter(l => l.address).map(l => [l.address!,    l]))
  const existingByLotNumber = new Map(allExisting.filter(l => l.lotNumber).map(l => [l.lotNumber!, l]))

  // Collect DB write ops — executed together in one transaction after the loop.
  // This gives us: (a) parallel execution to avoid Vercel timeout, (b) atomicity so
  // a mid-run failure doesn't leave the DB in a half-written state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbOps: Array<(tx: any) => Promise<unknown>> = []

  for (const l of listingsData as RawListing[]) {
    const isPlaceholder = !!(l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber))
    const rawAddress    = l.address   || null
    const rawLotNumber  = l.lotNumber || null

    // O(1) map lookup — no DB round-trip (all listings pre-fetched above)
    const existing =
      rawAddress   ? (existingByAddress.get(rawAddress)     ?? null) :
      rawLotNumber ? (existingByLotNumber.get(rawLotNumber) ?? null) :
      null

    const v = validateListing(l, community.name, existing?.status ?? undefined)
    if (!v.ok) {
      rejected.push({ address: l.address, lotNumber: l.lotNumber, reason: v.reason! })
      continue
    }
    if (v.warnings?.length) {
      warnings.push({ address: l.address, lotNumber: l.lotNumber, issues: v.warnings })
    }

    const address = v.cleanedAddress !== undefined ? v.cleanedAddress : rawAddress
    if (rawAddress && address && address !== rawAddress) {
      autoFixed.push({ address, fix: `Address cleaned: "${rawAddress}" → "${address}"` })
    }

    const status = v.forcedStatus || l.status || "active"
    if (v.forcedStatus) {
      autoFixed.push({ address: address || undefined, lotNumber: l.lotNumber, fix: `Status forced active → future (no price)` })
    }

    const soldAt = v.forcedSoldAt
      ?? (l.soldAt ? new Date(l.soldAt) : null)
      ?? (status === "sold" ? new Date() : null)

    const lotNumber = rawLotNumber

    // ── Table 3 lookup — real listings only (not placeholders) ───────────────
    // RULE: payload beds/sqft/baths/floors/propertyType/hoaFees/taxes ALWAYS ignored.
    // We pull these exclusively from Table 3 by (community, floorPlan).
    //
    // Matching order:
    //   1. Named lookup:  l.floorPlan → lookupPlan()
    //   2. Spec fallback: no l.floorPlan but l.sqft present → matchPlanBySpecs()
    //      (used by scrapers like KB Home that don't extract plan names)
    //   3. Existing floorPlan/sqft on record (re-match every ingest to pick up Table 3 edits)
    let t3: {
      planName?: string;
      beds: number | null; sqft: number | null; baths: number | null;
      floors: number | null; propertyType: string | null;
      hoaFees: number | null; taxes: string | null;
      moveInDate: string | null;
    } | null = null

    // resolvedFloorPlan: the plan name we'll store — normalized then Table 3 matched
    // normalizePlan strips community prefix + exterior letter codes (all except X)
    // so "Aria 1AX" → "1X", "Hazel 2M" → "2", "Kuro Contemporary" → "Kuro Contemporary"
    const rawFloorPlan    = l.floorPlan || null
    let resolvedFloorPlan = rawFloorPlan
      ? (normalizePlan(community.name, rawFloorPlan) ?? rawFloorPlan)
      : null

    if (!isPlaceholder && address) {
      if (l.floorPlan) {
        // Named lookup
        const plan = lookupPlan(table3Plans, community.name, l.floorPlan)
        if (plan) {
          t3 = plan
        } else {
          missingPlans.add(l.floorPlan)
        }
      } else if (l.sqft) {
        // Spec-based match when scraper sends sqft but no plan name
        const match = matchPlanBySpecs(table3Plans, community.name, l.sqft, l.beds, l.baths)
        if (match) {
          t3 = match.plan
          resolvedFloorPlan = match.planName
        }
      }
    }

    // For existing listings: re-fill null Table 3 fields on every ingest run.
    // Also attempts spec matching if the listing has no floorPlan yet.
    if (!isPlaceholder && existing && !t3) {
      if (existing.floorPlan) {
        const plan = lookupPlan(table3Plans, community.name, existing.floorPlan)
        if (plan) t3 = plan
      } else {
        // Try spec matching against existing sqft (or payload sqft)
        const specSqft = (l.sqft ?? existing.sqft) as number | null
        if (specSqft) {
          const specBeds  = (l.beds  ?? existing.beds)  as number | null
          const specBaths = (l.baths ?? existing.baths) as number | null
          const match = matchPlanBySpecs(table3Plans, community.name, specSqft, specBeds, specBaths)
          if (match) {
            t3 = match.plan
            if (!resolvedFloorPlan) resolvedFloorPlan = match.planName
          }
        }
      }
    }

    if (existing) {
      // Track price change
      if (l.currentPrice && existing.currentPrice && l.currentPrice !== existing.currentPrice) {
        const changeType = l.currentPrice > existing.currentPrice ? "increase" : "decrease"
        const _id = existing.id; const _price = l.currentPrice; const _ct = changeType
        dbOps.push((tx) => tx.priceHistory.create({ data: { listingId: _id, price: _price, changeType: _ct } }))
        results.priceChanges++
      }

      // Table 2 delta: active → sold on real listings
      if (!isPlaceholder && address && existing.status === "active" && status === "sold") {
        sheetDelta.sold    += 1
        sheetDelta.forSale -= 1
      }

      // Apply Table 3 values — always overwrite, Table 3 is the source of truth.
      const t3Fill = t3 ? {
        ...(t3.beds         != null ? { beds:         t3.beds         } : {}),
        ...(t3.sqft         != null ? { sqft:         t3.sqft         } : {}),
        ...(t3.baths        != null ? { baths:        t3.baths        } : {}),
        ...(t3.floors       != null ? { floors:       t3.floors       } : {}),
        ...(t3.propertyType != null ? { propertyType: t3.propertyType } : {}),
        ...(t3.hoaFees      != null ? { hoaFees:      t3.hoaFees      } : {}),
        ...(t3.taxes        != null ? { taxes:        t3.taxes        } : {}),
        ...(existing.moveInDate == null && t3.moveInDate != null ? { moveInDate: t3.moveInDate } : {}),
      } : {}

      if (Object.keys(t3Fill).length > 0) results.table3Filled++

      // scraperMode: only update status/price/soldAt/sourceUrl/lotNumber
      // non-scraperMode: also update garages, moveInDate, incentives, sourceUrl
      // NEITHER mode ever updates beds/sqft/baths/floors/propertyType/hoaFees/taxes from payload
      const _eid = existing.id
      if (scraperMode) {
        const _d = {
          lotNumber:    lotNumber                           ?? existing.lotNumber,
          floorPlan:    resolvedFloorPlan                  ?? existing.floorPlan,
          currentPrice: l.currentPrice      ?? existing.currentPrice,
          pricePerSqft: (l.currentPrice && (t3?.sqft ?? existing.sqft))
            ? Math.round(l.currentPrice / (t3?.sqft ?? existing.sqft)!)
            : existing.pricePerSqft,
          status,
          sourceUrl:    l.sourceUrl         ?? existing.sourceUrl,
          soldAt:       soldAt              ?? existing.soldAt,
          ...t3Fill,
        }
        dbOps.push((tx) => tx.listing.update({ where: { id: _eid }, data: _d }))
      } else {
        const _d = {
          lotNumber:     lotNumber                                ?? existing.lotNumber,
          floorPlan:     resolvedFloorPlan                       ?? existing.floorPlan,
          garages:       l.garages           ?? existing.garages,
          currentPrice:  l.currentPrice      ?? existing.currentPrice,
          pricePerSqft:  (l.currentPrice && (t3?.sqft ?? existing.sqft))
            ? Math.round(l.currentPrice / (t3?.sqft ?? existing.sqft)!)
            : l.pricePerSqft ?? existing.pricePerSqft,
          moveInDate:    sanitizeMoveInDate(l.moveInDate) ?? existing.moveInDate,
          incentives:    l.incentives         ?? existing.incentives,
          incentivesUrl: l.incentivesUrl      ?? existing.incentivesUrl,
          status,
          sourceUrl:     l.sourceUrl          ?? existing.sourceUrl,
          soldAt:        soldAt               ?? existing.soldAt,
          ...t3Fill,
        }
        dbOps.push((tx) => tx.listing.update({ where: { id: _eid }, data: _d }))
      }
      results.updated++

    } else {
      // New listing — Table 3 fields used directly, payload fields for those stripped
      const sqft = t3?.sqft ?? null
      const _createData = {
        communityId:   community.id,
        address,
        lotNumber,
        floorPlan:     resolvedFloorPlan || null,
        // ── Table 3 fields ONLY ─────────────────────────────────────────
        sqft,
        beds:          t3?.beds         ?? null,
        baths:         t3?.baths        ?? null,
        floors:        t3?.floors       ?? null,
        propertyType:  t3?.propertyType ?? null,
        hoaFees:       t3?.hoaFees      ?? null,
        taxes:         t3?.taxes        ?? null,
        // ── Scraper/payload fields ──────────────────────────────────────
        garages:       l.garages        || null,
        currentPrice:  l.currentPrice   || null,
        pricePerSqft:  (l.currentPrice && sqft)
          ? Math.round(l.currentPrice / sqft)
          : null,
        moveInDate:    sanitizeMoveInDate(l.moveInDate) || t3?.moveInDate || null,
        incentives:    l.incentives     || null,
        incentivesUrl: l.incentivesUrl  || null,
        status,
        sourceUrl:     l.sourceUrl      || null,
        soldAt,
      }
      const _initPrice = l.currentPrice || null
      // Create listing + initial priceHistory atomically inside the transaction closure
      dbOps.push(async (tx) => {
        const newListing = await tx.listing.create({ data: _createData })
        if (_initPrice) {
          await tx.priceHistory.create({
            data: { listingId: newListing.id, price: _initPrice, changeType: "initial" },
          })
        }
      })

      // Table 2 delta: new real listing added as active (new for-sale home)
      if (!isPlaceholder && address && status === "active") {
        sheetDelta.forSale += 1
      }

      if (t3) results.table3Filled++
      results.created++
    }
  }

  // ── Execute all DB writes atomically ─────────────────────────────────────
  // Promise.all parallelises updates (avoids N-sequential overhead / Vercel timeout).
  // $transaction ensures either everything commits or nothing does — no partial writes.
  if (dbOps.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.$transaction(async (tx: any) => {
      await Promise.all(dbOps.map((op) => op(tx)))
    }, { timeout: 45_000, maxWait: 10_000 })
  }

  // ── Table 2 write-back + placeholder sync ─────────────────────────────────
  // RULE: Only two events trigger a Table 2 update:
  //   1. active → sold   (sold+1, forSale-1)
  //   2. new listing added as active (forSale+1)
  // Any other delta is a bug — reject it before writing.

  let table2Update: { delta: typeof sheetDelta; result: "updated" | "failed" | "skipped" } | undefined

  if (sheetDelta.sold !== 0 || sheetDelta.forSale !== 0) {
    // Guardrail: delta must only move in expected directions
    // Guardrail: sold count can never decrease (that would mean un-selling a home).
    // forSale can increase by any amount (bulk ingest of new listings is valid).
    // It is also valid to both sell AND add new listings in the same batch.
    const invalidDelta = sheetDelta.sold < 0

    if (invalidDelta) {
      console.error(
        `[ingest] GUARDRAIL BLOCKED Table 2 write for "${community.name}". ` +
        `Invalid delta: sold=${sheetDelta.sold}, forSale=${sheetDelta.forSale}. ` +
        `Only active→sold (sold+1,forSale-1) or new active (forSale+1) are allowed.`
      )
      table2Update = { delta: sheetDelta, result: "failed" }
    } else {
      try {
        const newCounts = await updateTable2(existingBuilder.name, community.name, sheetDelta)
        if (newCounts) {
          await syncPlaceholders(community.id, newCounts)

          // ── Post-write validation: confirm DB placeholders match sheet ──────
          const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/
          const placeholders = await prisma.listing.findMany({
            where:  { communityId: community.id, address: null },
            select: { status: true, lotNumber: true },
          })
          const valid = placeholders.filter(l => PLACEHOLDER_RE.test(l.lotNumber ?? ""))
          const dbSold   = valid.filter(l => l.status === "sold").length
          const dbAvail  = valid.filter(l => l.status === "active").length
          const dbFuture = valid.filter(l => l.status === "future").length

          if (dbSold !== newCounts.sold || dbAvail !== newCounts.forSale || dbFuture !== newCounts.future) {
            console.error(
              `[ingest] GUARDRAIL: DB placeholders don't match sheet after sync for "${community.name}". ` +
              `Sheet: sold=${newCounts.sold} forSale=${newCounts.forSale} future=${newCounts.future}. ` +
              `DB: sold=${dbSold} forSale=${dbAvail} future=${dbFuture}.`
            )
          } else {
            console.log(`[ingest] Table 2 ✅ "${community.name}": sold=${newCounts.sold} forSale=${newCounts.forSale} future=${newCounts.future} — DB in sync`)
          }

          table2Update = { delta: sheetDelta, result: "updated" }
        } else {
          console.warn(`[ingest] Sheet write skipped for "${community.name}". Delta: sold=${sheetDelta.sold}, forSale=${sheetDelta.forSale}`)
          table2Update = { delta: sheetDelta, result: "failed" }
        }
      } catch (err) {
        console.error("[ingest] Sheet write-back error (non-fatal):", err)
        table2Update = { delta: sheetDelta, result: "failed" }
      }
    }
  }

  // ── Send alert for floorplans not yet in Table 3 ──────────────────────────
  if (missingPlans.size > 0) {
    const missingList = [...missingPlans]
    console.warn(`[ingest] ${missingList.length} floorplan(s) missing from Table 3 for "${community.name}": ${missingList.join(", ")}`)
    // Await so Vercel doesn't tear down the function before the email fires
    await sendMissingPlanAlert(existingBuilder.name, community.name, missingList)
  }

  // ── Rule 16: Cross-community duplicate address detection ──────────────────
  // Gated behind checkDuplicates:true — this is a full-table scan and should
  // only be run on demand, not on every ingest call.
  let duplicates: { address: string; foundIn: string[] }[] = []
  if (body.checkDuplicates === true) {
    const normalize = (a: string) => a.toLowerCase().replace(SUFFIX_RE, "").replace(CITY_RE, "").trim()

    const [thisAddresses, otherAddresses] = await Promise.all([
      prisma.listing.findMany({ where: { communityId: community.id, address: { not: null } }, select: { address: true } }),
      prisma.listing.findMany({ where: { communityId: { not: community.id }, address: { not: null } }, select: { address: true, community: { select: { name: true } } } }),
    ])

    const otherMap = new Map<string, string[]>()
    for (const l of otherAddresses) {
      const key = normalize(l.address!)
      if (!otherMap.has(key)) otherMap.set(key, [])
      if (!otherMap.get(key)!.includes(l.community.name)) otherMap.get(key)!.push(l.community.name)
    }

    for (const { address } of thisAddresses) {
      if (!address) continue
      const found = otherMap.get(normalize(address))
      if (found?.length) duplicates.push({ address, foundIn: found })
    }
  }

  return NextResponse.json({
    ok: true,
    community:      community.name,
    builder:        existingBuilder.name,
    ...results,
    missingTable3:  missingPlans.size  ? [...missingPlans]    : undefined,
    rejected:       rejected.length   ? rejected              : undefined,
    autoFixed:      autoFixed.length  ? autoFixed             : undefined,
    warnings:       warnings.length   ? warnings              : undefined,
    duplicates:     duplicates.length ? duplicates            : undefined,
    table2Update:   table2Update                             ?? undefined,
  })
}
