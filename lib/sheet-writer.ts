/**
 * lib/sheet-writer.ts
 *
 * Writes updated Table 2 counts back to the Google Sheet whenever a scraper
 * (or manual ingest) detects a status change on a real listing.
 *
 * Authentication: Google Service Account JWT (no googleapis package needed).
 * Set env var GOOGLE_SERVICE_ACCOUNT_JSON to the service account JSON string.
 *
 * Table 2 column layout (0-indexed in CSV / A-based in Sheets):
 *   col A (0) = row marker (empty, or "Table 3" to mark end of Table 2)
 *   col D (3) = Community name
 *   col E (4) = Sold Homes
 *   col F (5) = For-Sale Homes
 *   col G (6) = Future Release
 *   col H (7) = Total Homes
 *
 * RULE: Total is always recalculated as Sold + For-Sale + Future.
 *       Counts are never allowed to go below 0.
 */

import { createSign } from "crypto"
import { BUILDER_SHEET_TABS } from "./sheet-validator"

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
const SCOPE       = "https://www.googleapis.com/auth/spreadsheets"

// ── Token cache (one token per process, refreshed before expiry) ──────────────

let _tokenCache: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) {
    // Credentials not configured — sheet writes are silently skipped
    return null
  }

  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token
  }

  try {
    const sa  = JSON.parse(saJson)
    const now = Math.floor(Date.now() / 1000)

    // Build JWT header.payload
    const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const payload = Buffer.from(JSON.stringify({
      iss:   sa.client_email,
      scope: SCOPE,
      aud:   "https://oauth2.googleapis.com/token",
      exp:   now + 3600,
      iat:   now,
    })).toString("base64url")

    const signingInput = `${header}.${payload}`

    // Sign with service account private key
    const sign = createSign("RSA-SHA256")
    sign.update(signingInput)
    const signature = sign.sign(
      (sa.private_key as string).replace(/\\n/g, "\n"),
      "base64url",
    )
    const jwt = `${signingInput}.${signature}`

    // Exchange JWT for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:  jwt,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error(`[sheet-writer] Token exchange failed (${tokenRes.status}): ${err}`)
      return null
    }

    const data = await tokenRes.json() as { access_token: string; expires_in: number }
    _tokenCache = {
      token:     data.access_token,
      expiresAt: (now + (data.expires_in ?? 3600) - 60) * 1000, // 60s early refresh
    }
    return _tokenCache.token

  } catch (err) {
    console.error("[sheet-writer] Auth error:", err)
    return null
  }
}

// ── Sheet I/O ─────────────────────────────────────────────────────────────────

/** Read rows A1:H300 from the given tab. Returns raw 2D string array. */
async function readRows(token: string, tabName: string): Promise<string[][]> {
  const range = encodeURIComponent(`${tabName}!A1:H300`)
  const res   = await fetch(`${SHEETS_BASE}/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error(`[sheet-writer] Read failed (${res.status}) for tab "${tabName}"`)
    return []
  }
  const data = await res.json() as { values?: string[][] }
  return data.values ?? []
}

/**
 * Write only Sold (col E) and For-Sale (col F) for a specific 1-based row.
 *
 * Future Release (col G) is NEVER written — it contains a sheet formula that
 * auto-recalculates whenever sold/forSale change.
 * Total (col H) is also a formula and is NEVER written.
 */
async function writeRow(
  token:     string,
  tabName:   string,
  rowNumber: number, // 1-based sheet row
  sold:      number,
  forSale:   number,
): Promise<boolean> {
  const range = encodeURIComponent(`${tabName}!E${rowNumber}:F${rowNumber}`)
  const res   = await fetch(
    `${SHEETS_BASE}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method:  "PUT",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [[sold, forSale]] }),
    },
  )
  if (!res.ok) {
    console.error(`[sheet-writer] Write failed (${res.status}) at row ${rowNumber} of "${tabName}"`)
  }
  return res.ok
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface Table2Counts {
  sold:    number
  forSale: number
  future:  number
  total:   number
}

/**
 * Update Table 2 counts for a community in the Google Sheet.
 *
 * Called automatically by the ingest route when a scraper reports:
 *   - A real listing going active → sold   (delta: { sold: +1, forSale: -1 })
 *   - A new real listing added as active   (delta: { forSale: +1 })
 *
 * Returns the updated counts on success, or null if:
 *   - GOOGLE_SERVICE_ACCOUNT_JSON is not set (credentials not configured)
 *   - The community row is not found in Table 2
 *   - Any network or auth error occurs
 *
 * The ingest route continues normally on null (sheet update is best-effort;
 * DB updates are never rolled back due to a sheet failure).
 */
export async function updateTable2(
  builderName:   string,
  communityName: string,
  delta:         { forSale?: number; sold?: number },
): Promise<Table2Counts | null> {

  // Must be a known builder with a sheet tab
  const tabName = BUILDER_SHEET_TABS[builderName]
  if (!tabName) {
    console.warn(`[sheet-writer] Unknown builder "${builderName}" — no tab mapping`)
    return null
  }

  // No-op delta
  if (!delta.forSale && !delta.sold) return null

  const token = await getAccessToken()
  if (!token) return null // credentials not configured, skip silently

  const rows = await readRows(token, tabName)
  if (!rows.length) return null

  // ── Find the community row ──────────────────────────────────────────────────
  let foundIndex = -1
  let current: Table2Counts | null = null

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i]
    const col0 = (row[0] ?? "").trim()
    const col3 = (row[3] ?? "").trim()

    if (col0 === "Table 3") break // end of Table 2
    if (col3.toLowerCase() === communityName.toLowerCase()) {
      foundIndex = i
      current = {
        sold:    parseInt(row[4] ?? "0") || 0,
        forSale: parseInt(row[5] ?? "0") || 0,
        future:  parseInt(row[6] ?? "0") || 0,
        total:   parseInt(row[7] ?? "0") || 0,
      }
      break
    }
  }

  if (foundIndex === -1 || !current) {
    console.warn(`[sheet-writer] Community "${communityName}" not found in Table 2 of "${tabName}"`)
    return null
  }

  // ── Apply delta to sold/forSale only — enforce floor of 0 ──────────────────
  const newSold    = Math.max(0, current.sold    + (delta.sold    ?? 0))
  const newForSale = Math.max(0, current.forSale + (delta.forSale ?? 0))

  // Future is formula-driven (G = Total − Sold − ForSale) — we NEVER write it.
  // We compute the expected new future so the caller can sync the DB placeholders.
  const newFuture = Math.max(0, current.total - newSold - newForSale)

  const sheetRow = foundIndex + 1 // convert 0-based index → 1-based sheet row

  // Write only E (Sold) and F (For-Sale); G (Future) and H (Total) are formulas.
  const ok = await writeRow(token, tabName, sheetRow, newSold, newForSale)

  if (!ok) return null

  const updated: Table2Counts = {
    sold:    newSold,
    forSale: newForSale,
    future:  newFuture,
    total:   current.total, // total formula doesn't change when homes shift categories
  }

  console.log(
    `[sheet-writer] "${communityName}" (${tabName}) row ${sheetRow}: ` +
    `sold ${current.sold}→${updated.sold}, ` +
    `forSale ${current.forSale}→${updated.forSale}, ` +
    `future (formula) ${current.future}→${updated.future}`,
  )

  return updated
}
