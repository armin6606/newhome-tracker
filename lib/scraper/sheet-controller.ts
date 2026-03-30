/**
 * sheet-controller.ts
 *
 * Reads the Google Sheet controller to drive scraping.
 *
 * URLs tab (gid=425679400): Community Name | URL
 *   - One row per community to scrape
 *   - Builder is inferred from the URL domain
 *
 * Main tab (gid=0): Community | City | Builder | Property Type | Plan | Beds | Baths | Sqft | Floors | HOA | Tax Rate | Elementary | Middle | High
 *   - Multiple rows per community (one per plan)
 *   - Main tab data ALWAYS takes priority over scraped values for every field it provides
 */

import type { ScrapedListing } from "./toll-brothers"

const SHEET_ID      = "1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo"
const URLS_TAB_GID  = "425679400"
const MAIN_TAB_GID  = "0"

// ─── Types ──────────────────────────────────────────────────────────────────

export type UrlRow = {
  communityName: string  // Short name from URLs tab (e.g. "Rhea", "Nova")
  url: string
  builder: string        // Inferred from URL domain (e.g. "Lennar")
}

/** Per-plan data from the Main tab (one row per plan variant) */
export type PlanMeta = {
  planName: string          // Raw plan name from sheet (e.g. "Plan 2", "2X") — overrides scraped floorPlan
  beds: number | undefined
  baths: number | undefined
  sqft: number | undefined
  floors: number | undefined
}

export type CommunityMeta = {
  displayName: string    // Full name from Main tab (e.g. "Rhea (Luna Park)")
  city: string
  builder: string
  propertyType: string | undefined
  hoa: number | undefined
  taxRate: number | undefined
  schools: string | undefined
  /** Default floors for all plans when no specific plan row matches (e.g. Elm at GPN has floors=3 but no plan names) */
  defaultFloors: number | undefined
  /** Plan variant → per-plan data. Key is the normalized variant (e.g. "1", "2x", "2b") */
  plans: Map<string, PlanMeta>
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

async function fetchCsv(gid: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) return []
  const text = await res.text()

  return text.split(/\r?\n/).filter(l => l.trim()).map(line => {
    const cols: string[] = []
    let current = ""
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = "" }
      else { current += ch }
    }
    cols.push(current.trim())
    return cols
  })
}

function builderFromUrl(url: string): string {
  if (url.includes("lennar.com"))                return "Lennar"
  if (url.includes("tollbrothers.com"))          return "Toll Brothers"
  if (url.includes("kbhome.com"))                return "KB Home"
  if (url.includes("tripointehomes.com"))        return "TRI Pointe Homes"
  if (url.includes("pulte.com"))                 return "Pulte Homes"
  if (url.includes("sheahomes.com"))             return "Shea Homes"
  if (url.includes("taylormorrison.com"))        return "Taylor Morrison"
  if (url.includes("brookfieldresidential.com")) return "Brookfield Residential"
  return "Unknown"
}

// ─── Plan variant normalizer ──────────────────────────────────────────────────

/**
 * Extract and normalize the plan variant from any plan name string.
 * Main tab uses "Plan 1", "Plan 2X"; scraper returns "Rhea 1", "Torrey 4", "Nova 2X", "Isla 2B".
 * We strip the community prefix and normalize to lowercase (e.g. "2x", "2b", "1").
 */
function normalizePlanVariant(planName: string | undefined): string {
  if (!planName) return ""
  // Extract trailing number+suffix: "Rhea 1" → "1", "Nova 2X" → "2x", "Isla 2B" → "2b"
  const m = planName.match(/(\d+\w*)$/i)
  return m ? m[1].toLowerCase() : planName.toLowerCase().trim()
}

/**
 * Try multiple variant keys for a plan name, from most specific to least.
 * e.g. "Isla 2B" tries ["2b", "2"] so it matches sheet row "2" if "2b" is missing.
 */
function findPlanMeta(plans: Map<string, PlanMeta>, planName: string | undefined): PlanMeta | undefined {
  if (!planName) return undefined
  const full = normalizePlanVariant(planName)
  if (!full) return undefined
  // Try exact match first
  if (plans.has(full)) return plans.get(full)
  // Try stripping trailing letter(s): "2b" → "2", "2x" → try both "2x" and "2"
  const numOnly = full.replace(/[a-z]+$/i, "")
  if (numOnly && numOnly !== full && plans.has(numOnly)) return plans.get(numOnly)
  return undefined
}

// ─── Fetch functions ─────────────────────────────────────────────────────────

export async function fetchUrlsTab(): Promise<UrlRow[]> {
  const rows = await fetchCsv(URLS_TAB_GID)
  if (rows.length < 2) return []
  return rows.slice(1)
    .map(cols => ({
      communityName: cols[0]?.trim() || "",
      url:           cols[1]?.trim() || "",
      builder:       builderFromUrl(cols[1]?.trim() || ""),
    }))
    .filter(r => r.communityName && r.url)
}

/**
 * Read the Main tab → map of display community name → CommunityMeta (with per-plan data).
 * Main tab columns:
 *   Community(0) City(1) Builder(2) PropertyType(3) Plan(4) Beds(5) Baths(6) Sqft(7) Floors(8)
 *   HOA(9) TaxRate(10) Elementary(11) Middle(12) High(13)
 */
export async function fetchMainTabMeta(): Promise<Map<string, CommunityMeta>> {
  const rows = await fetchCsv(MAIN_TAB_GID)
  const map = new Map<string, CommunityMeta>()

  for (const cols of rows.slice(1)) {
    const displayName = cols[0]?.trim()
    if (!displayName) continue

    // Community-level fields (same across all plans — use first row as source of truth)
    if (!map.has(displayName)) {
      const hoa     = parseFloat(cols[9]?.replace(/[^0-9.]/g, "") || "")
      const taxRate = parseFloat(cols[10]?.replace(/[^0-9.]/g, "") || "")
      const el  = cols[11]?.trim()
      const mid = cols[12]?.trim()
      const hi  = cols[13]?.trim()
      const schools = [el, mid, hi].filter(s => s && s !== "-").join(", ") || undefined

      map.set(displayName, {
        displayName,
        city:         cols[1]?.trim() || "",
        builder:      cols[2]?.trim() || "",
        propertyType: cols[3]?.trim() || undefined,
        hoa:          !isNaN(hoa)     && hoa > 0     ? Math.round(hoa) : undefined,
        taxRate:      !isNaN(taxRate) && taxRate > 0 ? taxRate          : undefined,
        schools,
        defaultFloors: undefined,
        plans: new Map(),
      })
    }

    // Per-plan fields — add to the community's plan map
    const planRaw = cols[4]?.trim()  // e.g. "Plan 1", "Plan 2X", or empty for community-level defaults
    const floors  = parseFloat(cols[8]?.replace(/[^0-9.]/g, "") || "")
    const validFloors = !isNaN(floors) && floors > 0 ? Math.round(floors) : undefined

    if (planRaw) {
      const variant = normalizePlanVariant(planRaw)
      const beds    = parseFloat(cols[5]?.replace(/[^0-9.]/g, "") || "")
      const baths   = parseFloat(cols[6]?.replace(/[^0-9.]/g, "") || "")
      const sqft    = parseFloat(cols[7]?.replace(/[^0-9.]/g, "") || "")

      map.get(displayName)!.plans.set(variant, {
        planName: planRaw,
        beds:   !isNaN(beds)   && beds > 0   ? beds   : undefined,
        baths:  !isNaN(baths)  && baths > 0  ? baths  : undefined,
        sqft:   !isNaN(sqft)   && sqft > 0   ? Math.round(sqft) : undefined,
        floors: validFloors,
      })
    } else if (validFloors !== undefined) {
      // No plan name but floors is filled — treat as community-level default
      // (e.g. "Elm at GPN" has floors=3 rows without plan names)
      const entry = map.get(displayName)!
      if (entry.defaultFloors === undefined) entry.defaultFloors = validFloors
    }
  }

  return map
}

/**
 * Find the best metadata entry for a URL row community name.
 * URLs tab uses short names (e.g. "Rhea") while Main tab uses full names (e.g. "Rhea (Luna Park)").
 */
export function matchMetaForCommunity(
  metaMap: Map<string, CommunityMeta>,
  urlCommunityName: string
): CommunityMeta | undefined {
  const needle = urlCommunityName.toLowerCase().trim()
  for (const [displayName, meta] of metaMap) {
    const hay = displayName.toLowerCase()
    if (hay.includes(needle) || needle.includes(hay.split(/[\s(]/)[0])) {
      return meta
    }
  }
  return undefined
}

/**
 * Apply sheet metadata to scraped listings.
 * Main tab ALWAYS wins — community-level fields (city, HOA, tax, property type, schools)
 * and per-plan fields (beds, baths, sqft, floors) override scraped values when present.
 */
export function applySheetDefaults(
  listings: ScrapedListing[],
  urlRow: UrlRow,
  meta: CommunityMeta | undefined
): ScrapedListing[] {
  const communityName = meta?.displayName || urlRow.communityName
  const city          = meta?.city        || ""

  return listings.map(listing => {
    // Look up per-plan data from Main tab (tries exact variant then numeric-only fallback)
    const planMeta = meta ? findPlanMeta(meta.plans, listing.floorPlan) : undefined

    // Store tax rate as integer × 100 (e.g. 1.89% → 189) — never calculate dollar amount
    const taxes = meta?.taxRate != null ? Math.round(meta.taxRate * 100) : listing.taxes

    return {
      ...listing,
      // Community-level — Main tab always wins
      communityName:  communityName,
      city:           meta?.city           || listing.city || city,
      propertyType:   meta?.propertyType   || listing.propertyType || "",
      hoaFees:        meta?.hoa            ?? listing.hoaFees,
      taxes,
      schools:        meta?.schools        || listing.schools,
      // Per-plan — Main tab always wins when present
      floorPlan:      planMeta?.planName   ?? listing.floorPlan,
      beds:           planMeta?.beds       ?? listing.beds,
      baths:          planMeta?.baths      ?? listing.baths,
      sqft:           planMeta?.sqft       ?? listing.sqft,
      floors:         planMeta?.floors     ?? meta?.defaultFloors ?? listing.floors,
      // Recalculate $/sqft if sqft changed
      pricePerSqft:   listing.price && (planMeta?.sqft ?? listing.sqft)
                        ? Math.round(listing.price / (planMeta?.sqft ?? listing.sqft)!)
                        : listing.pricePerSqft,
    }
  })
}
