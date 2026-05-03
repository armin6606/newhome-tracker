/**
 * lib/table3-reader.ts
 *
 * READ-ONLY access to Table 3 floorplan data from builder Google Sheets.
 *
 * RULES:
 *  - This file is ONLY called by the ingest route and backfill scripts.
 *  - Scrapers NEVER import or access this module directly.
 *  - Table 3 is the sole source of truth for: beds, sqft, baths, floors,
 *    propertyType, hoaFees, taxes. These fields are NEVER taken from the
 *    scraper payload — always looked up here.
 *
 * Table 3 column layout (0-indexed, same sheet as Table 2):
 *   col 0 (A): Community name
 *   col 1 (B): City
 *   col 2 (C): Floorplan name
 *   col 3 (D): Property type
 *   col 4 (E): Floors (stories)
 *   col 5 (F): Sqft
 *   col 6 (G): Beds
 *   col 7 (H): Baths
 *   col 8 (I): Move-in date (default/typical — scraper value overrides this)
 *   col 9 (J): HOA fees
 *  col 10 (K): Taxes
 *  col 11+ : School names (ignored — not stored in Listing model)
 */

import { BUILDER_SHEET_TABS } from "./sheet-validator"

const SHEET_ID     = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface Table3Plan {
  planName:     string        // original plan name from Table 3 (col C), preserved casing
  propertyType: string | null
  floors:       number | null
  sqft:         number | null
  beds:         number | null
  baths:        number | null
  moveInDate:   string | null
  hoaFees:      number | null
  taxes:        string | null
}

export interface Table3Match {
  planName: string
  plan:     Table3Plan
}

// Cache: builderName → { plans, expiresAt }
const _cache = new Map<string, { plans: Map<string, Table3Plan>; expiresAt: number }>()

function planKey(community: string, floorplan: string): string {
  return `${community.toLowerCase().trim()}|${floorplan.toLowerCase().trim()}`
}

/**
 * Normalize a floorplan name so it can match Table 3 entries.
 *
 * Rules (applied to ALL builders):
 *  1. Strip community name prefix (full name or first word)
 *     e.g. "Aria 1AX" → "1AX",  "Hazel 2M" → "2M",  "Isla 1C" → "1C"
 *  2. Strip "Plan " prefix
 *  3. If the remainder starts with a digit:
 *     - Keep the number + X if present, drop all other letters (exterior codes)
 *     - e.g. "1AX" → "1X",  "2M" → "2",  "3BXR" → "3X"
 *  4. If not digit-based (e.g. "Kuro Contemporary"): return trimmed as-is
 *
 * Exported so the ingest route can clean every incoming floorPlan before storage.
 */
// Exterior style suffixes that are NOT part of the base floorplan name.
// Stripped from the end of plan names so "Melina Prairie" → "Melina", etc.
const EXTERIOR_SUFFIX_RE = /\s+(Mid-Century Modern|Modern Farmhouse|California Modern|Modern Hacienda|Coastal Contemporary|Contemporary Craftsman|Prairie|Transitional|Contemporary|Coastal|Modern|Farmhouse|Craftsman|Tuscan|Italianate|Spanish|Hacienda)$/i

export function normalizePlan(communityName: string, planName: string): string | null {
  if (!planName) return null
  let s = planName.trim()
  s = s.replace(/^Plan\s+/i, "")
  // Strip community name with spaces (e.g. "Ridge View " → stripped)
  const escaped = communityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  s = s.replace(new RegExp(`^${escaped}\\s+`, "i"), "")
  // Strip community name with spaces collapsed (e.g. "Ridgeview " for "Ridge View")
  const collapsed = communityName.replace(/\s+/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (collapsed) s = s.replace(new RegExp(`^${collapsed}\\s+`, "i"), "").trim()
  // Strip first word of community name (e.g. "Ridge " for "Ridge View")
  const firstWord = (communityName.split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (firstWord) s = s.replace(new RegExp(`^${firstWord}\\s+`, "i"), "").trim()
  const m = s.match(/^(\d+)([A-Za-z]*)/)
  if (!m) {
    // Non-digit plan: strip exterior style suffixes (e.g. "Melina Prairie" → "Melina")
    let base = s.trim()
    let prev = ""
    while (prev !== base) { prev = base; base = base.replace(EXTERIOR_SUFFIX_RE, "").trim() }
    return base || planName.trim()
  }
  return m[1] + (/x/i.test(m[2]) ? "X" : "")
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(v.replace(/[,$\s]/g, ""))
  return isNaN(n) ? null : n
}

function parseCSV(text: string): string[][] {
  return text.split("\n").map((line) => {
    const cells: string[] = []
    let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')               inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                          cur += ch
    }
    return cells
  })
}

async function fetchTable3(tabName: string): Promise<Map<string, Table3Plan>> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  const plans = new Map<string, Table3Plan>()

  try {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) return plans

    const rows = parseCSV(await res.text())
    let inTable3 = false

    for (const row of rows) {
      const col0 = row[0]?.trim() ?? ""

      if (col0 === "Table 3")                           { inTable3 = true; continue }
      if (!inTable3)                                    continue
      if (col0 === "Community" || col0 === "Table 4")  continue // skip header / next table
      if (!col0)                                        continue // blank row

      const community = col0
      const floorplan = row[2]?.trim() ?? ""
      if (!floorplan) continue

      const plan: Table3Plan = {
        planName:     floorplan,
        propertyType: row[3]?.trim() || null,
        floors:       parseNum(row[4]),
        sqft:         parseNum(row[5]),
        beds:         parseNum(row[6]),
        baths:        parseNum(row[7]),
        moveInDate:   row[8]?.trim() || null,
        hoaFees:      parseNum(row[9]),
        taxes:        row[10]?.trim() || null,
      }
      plans.set(planKey(community, floorplan), plan)
      const nk = normalizePlan(community, floorplan)
      if (nk && nk !== floorplan.toLowerCase().trim()) {
        plans.set(planKey(community, nk), plan)
      }
    }
  } catch (err) {
    console.warn(`[table3-reader] fetchTable3 error for tab "${tabName}":`, err)
  }

  return plans
}

/**
 * Load all Table 3 floorplans for a builder.
 * Returns an empty Map (never null) — callers can always safely call lookupPlan().
 * Results are cached for 10 minutes.
 */
export async function getTable3Plans(builderName: string): Promise<Map<string, Table3Plan>> {
  const tabName = BUILDER_SHEET_TABS[builderName]
  if (!tabName) return new Map()

  const cached = _cache.get(builderName)
  if (cached && Date.now() < cached.expiresAt) return cached.plans

  const plans = await fetchTable3(tabName)
  _cache.set(builderName, { plans, expiresAt: Date.now() + CACHE_TTL_MS })
  return plans
}

/**
 * Look up a specific floorplan by community + plan name.
 * Returns null if not found (plan not yet in Table 3).
 */
export function lookupPlan(
  plans:        Map<string, Table3Plan>,
  community:    string,
  floorPlan:    string,
): Table3Plan | null {
  const exact = plans.get(planKey(community, floorPlan))
  if (exact) return exact
  const nk = normalizePlan(community, floorPlan)
  if (!nk) return null
  return plans.get(planKey(community, nk)) ?? null
}

/**
 * Match a floorplan by spec values (sqft + optionally beds/baths) when no
 * plan name is available (e.g. KB Home scraper).
 *
 * Filters to plans for the given community, then finds plans whose sqft is
 * within SQFT_TOLERANCE. If multiple candidates remain, narrows by beds/baths.
 * Returns null if no match or if the match is ambiguous (multiple plans fit).
 */
export function matchPlanBySpecs(
  plans:     Map<string, Table3Plan>,
  community: string,
  sqft:      number | null,
  beds?:     number | null,
  baths?:    number | null,
): Table3Match | null {
  if (!sqft) return null

  const SQFT_TOLERANCE = 50
  const prefix = community.toLowerCase().trim() + "|"

  const candidates: Table3Match[] = []
  for (const [key, plan] of plans) {
    if (!key.startsWith(prefix)) continue
    if (plan.sqft == null) continue
    if (Math.abs(plan.sqft - sqft) > SQFT_TOLERANCE) continue
    candidates.push({ planName: plan.planName, plan })
  }

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Narrow by beds and/or baths
  const narrowed = candidates.filter(c => {
    if (beds  != null && c.plan.beds  != null && c.plan.beds  !== beds)  return false
    if (baths != null && c.plan.baths != null && c.plan.baths !== baths) return false
    return true
  })

  return narrowed.length === 1 ? narrowed[0] : null
}
