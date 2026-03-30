/**
 * sheet-reader.ts
 *
 * Reads Google Sheet CSV exports for any builder tab.
 * Sheet structure (same for all builders):
 *   Row 1 = "Table 1" header
 *   Row 2 = column headers
 *   Row 3+ = data
 *     Col A = Community name (Table 1)
 *     Col B = URL (Table 1)
 *     Col D = Community name (Table 2)
 *     Col E = Sold Homes
 *     Col F = For-Sale Homes
 *     Col G = Future Release
 *     Col H = Total Homes
 */

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

export interface SheetCommunityRow {
  communityName: string
  url: string
  sold: number
  forSale: number
  future: number
  total: number
}

/** Parse a CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ""
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  cols.push(current.trim())
  return cols
}

function parseNum(val: string | undefined): number {
  if (!val) return 0
  const n = parseInt(val.replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? 0 : n
}

/**
 * Fetch and parse a builder Google Sheet tab.
 * Skips rows where col A (community name) or col B (URL) is empty.
 */
export async function fetchBuilderSheet(gid: string): Promise<SheetCommunityRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet gid=${gid}: HTTP ${res.status}`)
  }
  const text = await res.text()

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  // Row 0 = "Table 1" header label, Row 1 = column headers, Row 2+ = data
  // Skip first 2 rows
  const dataRows = lines.slice(2)

  const results: SheetCommunityRow[] = []
  for (const line of dataRows) {
    const cols = parseCsvLine(line)
    const communityName = cols[0]?.trim() || ""
    const url = cols[1]?.trim() || ""
    // Skip rows without a name or URL
    if (!communityName || !url) continue

    // Col D (index 3) = Table 2 community name (ignored — we use col A)
    // Col E (index 4) = Sold, Col F (index 5) = For-Sale, Col G (index 6) = Future, Col H (index 7) = Total
    const sold = parseNum(cols[4])
    const forSale = parseNum(cols[5])
    const future = parseNum(cols[6])
    const total = parseNum(cols[7])

    results.push({ communityName, url, sold, forSale, future, total })
  }

  return results
}
