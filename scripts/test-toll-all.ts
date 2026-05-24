import { scrapeTollApollo } from "../lib/scraper/toll-brothers"

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEET_GID = "0"

interface SheetCommunityRow {
  communityName: string
  url: string
  expectedTotal: number
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1]

    if (ch === '"' && inQuotes && next === '"') {
      current += '"'
      i++
    } else if (ch === '"') {
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

async function fetchTollRows(): Promise<SheetCommunityRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to fetch Toll sheet: HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return lines.slice(2).flatMap((line) => {
    const cols = parseCsvLine(line)
    const communityName = cols[0]?.trim()
    const url = cols[1]?.trim()
    const expectedTotal = parseInt((cols[7] ?? "").replace(/[^0-9]/g, ""), 10) || 0
    return communityName && url?.startsWith("http") ? [{ communityName, url, expectedTotal }] : []
  })
}

async function main() {
  const rows = await fetchTollRows()
  const failures: string[] = []

  console.log(`[TollAll] Testing ${rows.length} Toll Brothers communities\n`)

  for (const [index, row] of rows.entries()) {
    const label = `${index + 1}/${rows.length} ${row.communityName}`
    try {
      console.log(`[TollAll] ${label}`)
      const result = await scrapeTollApollo(row.url, {
        communityName: row.communityName,
        expectedTotal: row.expectedTotal,
        debugDir: "debug/toll-test",
      })

      if (!result.soldOut && result.total === 0) {
        failures.push(`${row.communityName}: returned zero lots`)
        console.log(`  FAIL zero lots`)
        continue
      }

      if (!result.soldOut && result.total !== result.lots.length) {
        failures.push(`${row.communityName}: total ${result.total} does not match lots ${result.lots.length}`)
        console.log(`  FAIL count mismatch total=${result.total} lots=${result.lots.length}`)
        continue
      }

      if (!result.soldOut && row.expectedTotal > 0 && result.total !== row.expectedTotal) {
        failures.push(`${row.communityName}: scraped total ${result.total} does not match Table 2 Total Homes ${row.expectedTotal}`)
        console.log(`  FAIL expected total mismatch scraped=${result.total} expected=${row.expectedTotal}`)
        continue
      }

      console.log(
        `  OK total=${result.total}/${row.expectedTotal || "?"} forSale=${result.forSale} sold=${result.sold} future=${result.future}` +
        (result.soldOut ? " soldOut=true" : "")
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`${row.communityName}: ${message}`)
      console.log(`  FAIL ${message}`)
    }
  }

  console.log("\n[TollAll] Summary")
  console.log(`  Passed: ${rows.length - failures.length}`)
  console.log(`  Failed: ${failures.length}`)

  for (const failure of failures) {
    console.log(`  - ${failure}`)
  }

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
