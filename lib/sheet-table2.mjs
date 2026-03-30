/**
 * sheet-table2.mjs
 *
 * Reads Table 2 (lot counts) from a builder's Google Sheet tab.
 * Returns a map of communityName → { sold, forSale, future, total }
 *
 * Sheet structure (all builder tabs):
 *   col 3 = community name
 *   col 4 = Sold Homes
 *   col 5 = For-Sale Homes
 *   col 6 = Future Release
 *   col 7 = Total Homes
 *
 * Access by sheet tab name (no GID needed):
 *   https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={TabName}
 */

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

/**
 * @param {string} sheetTabName  e.g. "Taylor Communities", "Pulte Communities"
 * @returns {Promise<Object>}    { "Aurora": { sold:0, forSale:7, future:40, total:47 }, ... }
 */
export async function fetchTable2Counts(sheetTabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetTabName)}`
  try {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) {
      console.warn(`  Sheet fetch failed (${res.status}) for tab "${sheetTabName}"`)
      return {}
    }
    const rows = parseCSV(await res.text())
    const counts = {}

    for (const row of rows) {
      const name = row[3]?.trim()
      // Skip header rows and Table 3 marker
      if (!name || name === "Table 2 Community" || name === "Table 2" || name === "Community") continue
      if (row[0]?.trim() === "Table 3") break

      const sold    = parseInt(row[4]) || 0
      const forSale = parseInt(row[5]) || 0
      const future  = parseInt(row[6]) || 0
      const total   = parseInt(row[7]) || 0
      if (sold === 0 && forSale === 0 && future === 0 && total === 0) continue

      counts[name] = { sold, forSale, future, total }
    }

    console.log(`  Sheet Table 2 loaded (${sheetTabName}): ${Object.keys(counts).length} communities`)
    return counts
  } catch (err) {
    console.warn(`  Sheet Table 2 error for "${sheetTabName}": ${err.message}`)
    return {}
  }
}

/**
 * Given sheet counts and current DB placeholder listings, return the
 * ingest entries needed to reconcile (add) and the IDs to mark removed.
 *
 * @param {object} sheetCounts   { sold, forSale, future }
 * @param {object} dbPlaceholders { sold: [{id,lotNumber}], avail: [...], future: [...] }
 * @param {number} realActiveCount  Number of real (address-based) active listings in DB
 * @returns {{ toIngest: object[], removeIds: number[] }}
 */
export function reconcilePlaceholders(sheetCounts, dbPlaceholders, realActiveCount = 0) {
  const toIngest  = []
  const removeIds = []

  // ── Sold placeholders ───────────────────────────────────────────────────
  const dbSold   = dbPlaceholders.sold.length
  const needSold = Math.max(0, sheetCounts.sold)

  if (needSold > dbSold) {
    for (let i = dbSold + 1; i <= needSold; i++)
      toIngest.push({ lotNumber: `sold-${i}`, status: "sold" })
  } else if (needSold < dbSold) {
    const sorted = [...dbPlaceholders.sold].sort((a, b) => {
      const na = parseInt((a.lotNumber ?? "").replace("sold-", "")) || 0
      const nb = parseInt((b.lotNumber ?? "").replace("sold-", "")) || 0
      return nb - na
    })
    removeIds.push(...sorted.slice(0, dbSold - needSold).map(l => l.id))
  }

  // ── Active (avail) placeholders ─────────────────────────────────────────
  // Sheet forSale = real active listings + avail placeholders
  const dbAvail   = dbPlaceholders.avail.length
  const needAvail = Math.max(0, sheetCounts.forSale - realActiveCount)

  if (needAvail > dbAvail) {
    for (let i = dbAvail + 1; i <= needAvail; i++)
      toIngest.push({ lotNumber: `avail-${i}`, status: "active" })
  } else if (needAvail < dbAvail) {
    const sorted = [...dbPlaceholders.avail].sort((a, b) => {
      const na = parseInt((a.lotNumber ?? "").replace("avail-", "")) || 0
      const nb = parseInt((b.lotNumber ?? "").replace("avail-", "")) || 0
      return nb - na
    })
    removeIds.push(...sorted.slice(0, dbAvail - needAvail).map(l => l.id))
  }

  // ── Future placeholders ─────────────────────────────────────────────────
  const dbFuture   = dbPlaceholders.future.length
  const needFuture = Math.max(0, sheetCounts.future)

  if (needFuture > dbFuture) {
    for (let i = dbFuture + 1; i <= needFuture; i++)
      toIngest.push({ lotNumber: `future-${i}`, status: "future" })
  } else if (needFuture < dbFuture) {
    const sorted = [...dbPlaceholders.future].sort((a, b) => {
      const na = parseInt((a.lotNumber ?? "").replace("future-", "")) || 0
      const nb = parseInt((b.lotNumber ?? "").replace("future-", "")) || 0
      return nb - na
    })
    removeIds.push(...sorted.slice(0, dbFuture - needFuture).map(l => l.id))
  }

  return { toIngest, removeIds }
}
