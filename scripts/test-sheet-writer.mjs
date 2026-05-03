/**
 * test-sheet-writer.mjs
 * One-time test: reads Table 2 for Toll Brothers and re-writes the first
 * community's counts back (no change in values — just proves auth + read/write work).
 *
 * Run: node scripts/test-sheet-writer.mjs
 */

import { createSign } from "crypto"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.replace(/\r/, "").trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 0) continue
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "")
    if (k && !process.env[k]) process.env[k] = v
  }
}

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
const SCOPE       = "https://www.googleapis.com/auth/spreadsheets"
const TAB         = "Toll Communities"

async function getToken() {
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  const now = Math.floor(Date.now() / 1000)
  const hdr = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  })).toString("base64url")
  const input = `${hdr}.${pay}`
  const sign  = createSign("RSA-SHA256")
  sign.update(input)
  const sig = sign.sign(sa.private_key.replace(/\\n/g, "\n"), "base64url")
  const jwt = `${input}.${sig}`

  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`)
  console.log("  ✓ Authenticated as:", JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email)
  return data.access_token
}

async function main() {
  console.log("=".repeat(60))
  console.log(" Sheet Write Test")
  console.log("=".repeat(60))

  const token = await getToken()

  // Read Table 2
  const range  = encodeURIComponent(`${TAB}!A1:H300`)
  const getRes = await fetch(`${SHEETS_BASE}/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!getRes.ok) throw new Error(`Read failed: ${getRes.status} ${await getRes.text()}`)
  const { values } = await getRes.json()
  console.log(`  ✓ Read ${values.length} rows from "${TAB}"`)

  // Find first real community row (col D not empty, not a header)
  let targetRow = -1
  let community = ""
  let counts = null
  for (let i = 0; i < values.length; i++) {
    const row  = values[i]
    const col0 = (row[0] ?? "").trim()
    const col3 = (row[3] ?? "").trim()
    if (col0 === "Table 3") break
    if (col3 && col3 !== "Table 2 Community" && col3 !== "Community" && col3 !== "Table 2") {
      const sold    = parseInt(row[4] ?? "0") || 0
      const forSale = parseInt(row[5] ?? "0") || 0
      const future  = parseInt(row[6] ?? "0") || 0
      const total   = parseInt(row[7] ?? "0") || 0
      if (sold + forSale + future + total > 0) {
        targetRow = i + 1 // 1-based
        community = col3
        counts = { sold, forSale, future, total }
        break
      }
    }
  }

  if (!counts) throw new Error("No community data found in Table 2")
  console.log(`  Target: "${community}" at row ${targetRow}`)
  console.log(`  Current: sold=${counts.sold}, forSale=${counts.forSale}, future=${counts.future}, total=${counts.total}`)

  // Write back the SAME values (no actual change — just tests the write path)
  const writeRange = encodeURIComponent(`${TAB}!E${targetRow}:H${targetRow}`)
  const putRes = await fetch(
    `${SHEETS_BASE}/${SHEET_ID}/values/${writeRange}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[counts.sold, counts.forSale, counts.future, counts.total]] }),
    },
  )
  if (!putRes.ok) {
    const err = await putRes.text()
    throw new Error(`Write failed (${putRes.status}): ${err}`)
  }
  const writeData = await putRes.json()
  console.log(`  ✓ Write confirmed — updatedCells: ${writeData.updatedCells}`)
  console.log(`  ✓ Sheet write-back is fully working!`)
  console.log("=".repeat(60))
}

main().catch(err => { console.error("FAILED:", err.message); process.exit(1) })
