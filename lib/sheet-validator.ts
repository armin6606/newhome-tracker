/**
 * sheet-validator.ts
 *
 * Guardrail: only builders/communities present in the Google Sheet are permitted
 * to appear on the website or be ingested.
 *
 * Two checks enforced:
 *   1. Builder must have a tab in BUILDER_SHEET_TABS
 *   2. Community name must exist in Table 2 of that tab
 *
 * Results are cached in memory for CACHE_TTL_MS to avoid a sheet fetch on
 * every request.
 */

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Map of exact DB builder name → Google Sheet tab name.
 * Builders NOT listed here are blocked from ingest and hidden from the site.
 */
export const BUILDER_SHEET_TABS: Record<string, string> = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
  "Shea Homes":      "Shea Communities",
}

// ── In-memory cache ────────────────────────────────────────────────────────

const cache = new Map<string, { communities: Set<string>; expiresAt: number }>()

function parseCSV(text: string): string[][] {
  return text.split("\n").map((line) => {
    const cells: string[] = []
    let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')               inQ = !inQ
      else if (ch === "," && !inQ){ cells.push(cur.trim()); cur = "" }
      else                          cur += ch
    }
    return cells
  })
}

/**
 * Fetch Table 2 community names from a builder's Google Sheet tab.
 * Returns a Set of community names (trimmed, exact match required).
 * Returns null if the tab cannot be fetched or appears to be a redirect to
 * the default tab (detected by checking for known Toll Brothers communities).
 */
async function fetchTable2Communities(tabName: string): Promise<Set<string> | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  try {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) return null
    const rows = parseCSV(await res.text())

    const names = new Set<string>()
    let inTable2 = false
    for (const row of rows) {
      const col0 = row[0]?.trim() ?? ""
      const col3 = row[3]?.trim() ?? ""
      if (col0 === "Table 3") break
      if (col3 === "Table 2 Community" || col3 === "Community") { inTable2 = true; continue }
      if (inTable2 && col3) names.add(col3)
    }

    // Sanity check: if we got Toll Brothers communities back (default tab fallback),
    // treat the requested tab as non-existent.
    const TOLL_SENTINEL = new Set(["Elm Collection", "Rowan Collection", "Pinnacle", "Skyline", "Birch"])
    if (tabName !== "Toll Communities") {
      for (const name of names) {
        if (TOLL_SENTINEL.has(name)) return null // got default tab, not requested tab
      }
    }

    return names.size > 0 ? names : null
  } catch {
    return null
  }
}

/**
 * Get the verified Table 2 community names for a builder's sheet tab.
 * Returns null if the builder has no tab or the tab is inaccessible.
 * Results are cached for CACHE_TTL_MS.
 */
export async function getSheetCommunities(builderName: string): Promise<Set<string> | null> {
  const tabName = BUILDER_SHEET_TABS[builderName]
  if (!tabName) return null

  const cached = cache.get(tabName)
  if (cached && Date.now() < cached.expiresAt) return cached.communities

  const communities = await fetchTable2Communities(tabName)
  if (communities) {
    cache.set(tabName, { communities, expiresAt: Date.now() + CACHE_TTL_MS })
    return communities
  }

  // Fetch failed — return stale cached data rather than blocking all ingests.
  // This keeps the site working during brief Google Sheet outages.
  if (cached) {
    console.warn(`[sheet-validator] Fetch failed for "${tabName}" — using stale cached data (${Math.round((Date.now() - (cached.expiresAt - CACHE_TTL_MS)) / 60000)}m old)`)
    return cached.communities
  }

  return null
}

/**
 * Returns true if the builder has a sheet tab AND the community name
 * appears in Table 2 of that tab.
 */
export async function isSheetVerified(builderName: string, communityName: string): Promise<boolean> {
  const communities = await getSheetCommunities(builderName)
  if (!communities) return false
  return communities.has(communityName)
}
