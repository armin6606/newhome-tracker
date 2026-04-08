/**
 * lib/normalizer.ts
 *
 * Fuzzy-normalizes builder and community names to their canonical Google Sheet names.
 *
 * BUILDER NORMALIZATION
 *   Canonical names are the keys of BUILDER_SHEET_TABS in sheet-validator.ts.
 *   Any incoming name that is a variation (prefix match, contains, known alias)
 *   is mapped to its canonical form before hitting the DB.
 *
 * COMMUNITY NORMALIZATION
 *   Canonical names are read from Table 2 of the builder's Google Sheet tab.
 *   Matching order:
 *     1. Exact match (case-sensitive)
 *     2. Case-insensitive exact match
 *     3. Canonical name contained in scraped name (e.g. long API strings)
 *     4. Scraped name contained in canonical name
 *     5. Word-overlap score ≥ 0.6
 *   Returns null if no match found — caller should reject the ingest.
 */

import { BUILDER_SHEET_TABS, getSheetCommunities } from "./sheet-validator"

// ── Builder normalization ──────────────────────────────────────────────────────

const CANONICAL_BUILDERS = Object.keys(BUILDER_SHEET_TABS)

/**
 * Maps a raw builder name to its canonical form.
 * Returns the canonical name if a match is found, or null if unknown.
 *
 * Matching order:
 *   1. Exact match
 *   2. Case-insensitive exact
 *   3. Raw name CONTAINS the canonical name  (e.g. "Toll Brothers at GPN" → "Toll Brothers")
 *   4. Canonical name CONTAINS the raw name  (e.g. "Shea" → "Shea Homes")
 *   5. First-word match                      (e.g. "Pulte Homes" → "Pulte")
 */
export function normalizeBuilderName(raw: string): string | null {
  const trimmed = raw.trim()
  const lower   = trimmed.toLowerCase()

  // 1. Exact
  if (CANONICAL_BUILDERS.includes(trimmed)) return trimmed

  // 2. Case-insensitive exact
  const ciMatch = CANONICAL_BUILDERS.find(b => b.toLowerCase() === lower)
  if (ciMatch) return ciMatch

  // 3. Raw contains canonical (e.g. "Toll Brothers at Great Park Neighborhoods" contains "Toll Brothers")
  const containsCanonical = CANONICAL_BUILDERS.find(b => lower.includes(b.toLowerCase()))
  if (containsCanonical) return containsCanonical

  // 4. Canonical contains raw (e.g. "Shea" is contained in "Shea Homes")
  const canonicalContains = CANONICAL_BUILDERS.find(b => b.toLowerCase().includes(lower))
  if (canonicalContains) return canonicalContains

  // 5. First-word match (e.g. "Pulte Homes" → first word "pulte" matches "Pulte")
  const firstWord = lower.split(/\s+/)[0]
  const firstWordMatch = CANONICAL_BUILDERS.find(b => b.toLowerCase().startsWith(firstWord))
  if (firstWordMatch) return firstWordMatch

  return null
}

// ── Community normalization ────────────────────────────────────────────────────

/**
 * Maps a raw community name to its canonical Table 2 name for the given builder.
 * Returns the canonical name on success, or null if no match found.
 *
 * Matching order:
 *   1. Exact
 *   2. Case-insensitive exact
 *   3. Raw name CONTAINS canonical  (API returns "Builder at Community - Name" → extract "Name")
 *   4. Canonical CONTAINS raw       (scraped short name matches part of canonical)
 *   5. Word-overlap score ≥ 0.6
 */
export async function normalizeCommunityName(
  raw:         string,
  builderName: string,
): Promise<string | null> {
  const communities = await getSheetCommunities(builderName)
  if (!communities) return null

  const trimmed = raw.trim()
  const lower   = trimmed.toLowerCase()

  // 1. Exact
  if (communities.has(trimmed)) return trimmed

  // 2. Case-insensitive exact
  for (const c of communities) {
    if (c.toLowerCase() === lower) return c
  }

  // 3. Raw name contains canonical (e.g. "Toll Brothers at GPN - Elm Collection" contains "Elm Collection")
  for (const c of communities) {
    if (lower.includes(c.toLowerCase())) return c
  }

  // 4. Canonical contains raw (e.g. scraped "Aria" is contained in canonical "Aria")
  for (const c of communities) {
    if (c.toLowerCase().includes(lower)) return c
  }

  // 5. Word-overlap scoring — ignore short/common words
  const STOP = new Set(["at", "in", "the", "by", "of", "and", "for"])
  const rawWords = new Set(
    lower.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  )
  if (rawWords.size > 0) {
    let bestMatch: string | null = null
    let bestScore = 0
    for (const c of communities) {
      const cWords = c.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
      if (cWords.length === 0) continue
      const overlap = cWords.filter(w => rawWords.has(w)).length
      const score   = overlap / Math.max(cWords.length, rawWords.size)
      if (score > bestScore) {
        bestScore = score
        bestMatch = c
      }
    }
    if (bestScore >= 0.6 && bestMatch) return bestMatch
  }

  return null
}
