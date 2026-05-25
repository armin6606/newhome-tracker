import { readLennarMap } from "../lib/scraper/map-readers/lennar-map"

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEET_GID = "1235396983"

interface SheetCommunityRow {
  communityName: string
  url: string
  expectedSold: number
  expectedForSale: number
  expectedFuture: number
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

function parseNum(val: string | undefined): number {
  if (!val) return 0
  const n = parseInt(val.replace(/[^0-9]/g, ""), 10)
  return Number.isFinite(n) ? n : 0
}

async function fetchLennarRows(): Promise<SheetCommunityRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to fetch Lennar sheet: HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  return lines.slice(2).flatMap((line) => {
    const cols = parseCsvLine(line)
    const communityName = cols[0]?.trim()
    const url = cols[1]?.trim()
    return communityName && url?.startsWith("http")
      ? [{
          communityName,
          url,
          expectedSold: parseNum(cols[4]),
          expectedForSale: parseNum(cols[5]),
          expectedFuture: parseNum(cols[6]),
          expectedTotal: parseNum(cols[7]),
        }]
      : []
  })
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main() {
  const only = process.env.LENNAR_TEST_ONLY?.toLowerCase()
  const rows = (await fetchLennarRows()).filter((row) =>
    only ? row.communityName.toLowerCase().includes(only) : true
  )
  const failures: string[] = []
  const warnings: string[] = []

  console.log(`[LennarAll] Testing ${rows.length} Lennar communities\n`)

  for (const [index, row] of rows.entries()) {
    const label = `${index + 1}/${rows.length} ${row.communityName}`
    try {
      console.log(`[LennarAll] ${label}`)
      const result = await withTimeout(
        readLennarMap(row.url, row.communityName, undefined, undefined, {
          debugDir: "debug/lennar-test",
          communityName: row.communityName,
          skipDetails: true,
        }),
        90_000,
        row.communityName
      )

      const lots = result.lots ?? []
      const missingLotNumbers = lots.filter((lot) => !lot.lotNumber || /^lot-\d+$/.test(lot.lotNumber))
      const forSaleWithoutPrice = lots.filter((lot) => lot.status === "for sale" && lot.price == null)

      if (result.total === 0) {
        failures.push(`${row.communityName}: returned zero lots`)
        console.log("  FAIL zero lots")
        continue
      }

      if (result.total !== lots.length) {
        failures.push(`${row.communityName}: total ${result.total} does not match lots ${lots.length}`)
        console.log(`  FAIL count mismatch total=${result.total} lots=${lots.length}`)
        continue
      }

      if (row.expectedTotal > 0 && result.total !== row.expectedTotal) {
        failures.push(`${row.communityName}: scraped total ${result.total} does not match Table 2 Total Homes ${row.expectedTotal}`)
        console.log(`  FAIL expected total mismatch scraped=${result.total} expected=${row.expectedTotal}`)
        continue
      }

      if (forSaleWithoutPrice.length > 0) {
        failures.push(`${row.communityName}: ${forSaleWithoutPrice.length} for-sale lots have no price`)
        console.log(`  FAIL ${forSaleWithoutPrice.length} for-sale lots have no price`)
        continue
      }

      if (missingLotNumbers.length > 0) {
        warnings.push(`${row.communityName}: ${missingLotNumbers.length} lots missing a real lot number`)
      }

      console.log(
        `  OK total=${result.total}/${row.expectedTotal || "?"} ` +
        `forSale=${result.forSale}/${row.expectedForSale || "?"} ` +
        `sold=${result.sold}/${row.expectedSold || "?"} ` +
        `future=${result.future}/${row.expectedFuture || "?"}` +
        (missingLotNumbers.length ? ` warnings=${missingLotNumbers.length}` : "")
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`${row.communityName}: ${message}`)
      console.log(`  FAIL ${message}`)
    }
  }

  console.log("\n[LennarAll] Summary")
  console.log(`  Passed: ${rows.length - failures.length}`)
  console.log(`  Failed: ${failures.length}`)
  console.log(`  Warnings: ${warnings.length}`)

  for (const failure of failures) console.log(`  - ${failure}`)
  for (const warning of warnings) console.log(`  - WARN ${warning}`)

  if (failures.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
