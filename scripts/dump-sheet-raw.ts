/**
 * Dump the raw CSV from both sheet tabs to see exactly what's there.
 */
const SHEET_ID = "1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo"

async function fetchCsv(gid: string, label: string) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res = await fetch(url, { cache: "no-store" })
  const text = await res.text()
  const rows = text.split(/\r?\n/).filter(l => l.trim())
  console.log(`\n=== ${label} (${rows.length} rows) ===`)
  rows.forEach((r, i) => console.log(`  [${i}] ${r}`))
}

async function main() {
  await fetchCsv("0", "Main tab (gid=0)")
  await fetchCsv("425679400", "URLs tab (gid=425679400)")
}

main().catch(console.error)
