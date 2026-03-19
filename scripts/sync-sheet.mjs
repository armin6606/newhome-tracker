/**
 * sync-sheet.mjs
 *
 * Bidirectional sync between the newhome-tracker Prisma DB and a Google Sheet.
 *
 * DB → Sheet (push):
 *   All active listings are written to the sheet. Non-user-editable columns
 *   are always overwritten from DB values. User-editable columns (HOA, Tax,
 *   Move-In Date, Schools, Notes) are never touched during the push phase.
 *
 * Sheet → DB (pull):
 *   Any user-entered values in the editable columns are read back and written
 *   to the DB if they differ from what's already stored.
 *
 * Sheet layout (row 1 = header, row 2+ = data):
 *   A  Listing ID        (key, never overwritten after creation)
 *   B  Address
 *   C  Community
 *   D  Builder
 *   E  City
 *   F  Price ($)
 *   G  Beds
 *   H  Baths
 *   I  Sqft
 *   J  Floors
 *   K  $/sqft
 *   L  HOA ($/mo)        ← USER EDITABLE
 *   M  Annual Tax ($)    ← USER EDITABLE
 *   N  Move-In Date      ← USER EDITABLE
 *   O  Floor Plan
 *   P  Lot #
 *   Q  Garages
 *   R  Schools           ← USER EDITABLE
 *   S  Status
 *   T  Source URL
 *   U  Notes             ← USER EDITABLE
 *
 * Environment variables required:
 *   DATABASE_URL              - Postgres connection string (Prisma)
 *   DIRECT_URL                - Postgres direct URL (Prisma, optional)
 *   GOOGLE_SERVICE_ACCOUNT_JSON - Full JSON of service account key file
 *   SHEET_ID                  - Google Spreadsheet ID
 *   SHEET_NAME                - Sheet tab name (default: "Listings")
 */

import { google } from "googleapis"
import { PrismaClient } from "@prisma/client"

// ── Config ─────────────────────────────────────────────────────────────────

const SHEET_ID   = process.env.SHEET_ID   || "1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo"
const SHEET_NAME = process.env.SHEET_NAME || "Listings"

// Column indices (0-based) for the editable columns that should NEVER be
// overwritten when pushing DB → sheet.
const USER_EDITABLE_COLS = new Set([11, 12, 13, 17, 20]) // L, M, N, R, U

// Total number of columns in the sheet
const TOTAL_COLS = 21 // A–U

const HEADER_ROW = [
  "Listing ID",
  "Address",
  "Community",
  "Builder",
  "City",
  "Price ($)",
  "Beds",
  "Baths",
  "Sqft",
  "Floors",
  "$/sqft",
  "HOA ($/mo)",
  "Annual Tax ($)",
  "Move-In Date",
  "Floor Plan",
  "Lot #",
  "Garages",
  "Schools",
  "Status",
  "Source URL",
  "Notes",
]

// ── Helpers ────────────────────────────────────────────────────────────────

function colLetter(idx) {
  // 0 → A, 1 → B, … 25 → Z
  return String.fromCharCode(65 + idx)
}

function rowRange(rowNum) {
  // rowNum is 1-based (row 1 = header)
  return `${SHEET_NAME}!A${rowNum}:${colLetter(TOTAL_COLS - 1)}${rowNum}`
}

/** Build the DB-sourced (non-editable) portion of a row from a listing. */
function dbRow(listing) {
  const pricePerSqft =
    listing.currentPrice && listing.sqft
      ? Math.round(listing.currentPrice / listing.sqft)
      : null

  return [
    String(listing.id),                          // A  Listing ID
    listing.address ?? "",                        // B  Address
    listing.community?.name ?? "",                // C  Community
    listing.community?.builder?.name ?? "",       // D  Builder
    listing.community?.city ?? "",                // E  City
    listing.currentPrice ?? "",                   // F  Price ($)
    listing.beds ?? "",                           // G  Beds
    listing.baths ?? "",                          // H  Baths
    listing.sqft ?? "",                           // I  Sqft
    listing.floors ?? "",                         // J  Floors
    pricePerSqft ?? "",                           // K  $/sqft
    listing.hoaFees ?? "",                        // L  HOA      (editable, but seeded from DB on first write)
    listing.taxes ?? "",                          // M  Tax       (editable, seeded)
    listing.moveInDate ?? "",                     // N  Move-In   (editable, seeded)
    listing.floorPlan ?? "",                      // O  Floor Plan
    listing.lotNumber ?? "",                      // P  Lot #
    listing.garages ?? "",                        // Q  Garages
    listing.schools ?? "",                        // R  Schools   (editable, seeded)
    listing.status ?? "active",                   // S  Status
    listing.sourceUrl ?? "",                      // T  Source URL
    "",                                           // U  Notes     (editable, empty by default)
  ]
}

/** Merge a full DB row with existing sheet values, preserving editable cols. */
function mergeRow(dbValues, sheetValues) {
  const merged = [...dbValues]
  for (const col of USER_EDITABLE_COLS) {
    const existing = sheetValues[col]
    if (existing !== undefined && existing !== null && existing !== "") {
      merged[col] = existing
    }
  }
  return merged
}

// ── Auth ───────────────────────────────────────────────────────────────────

function buildAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set. " +
      "See SHEETS_SETUP.md for instructions."
    )
  }
  const credentials = JSON.parse(raw)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  })
  return auth
}

// ── Sheet helpers ──────────────────────────────────────────────────────────

async function ensureHeaderRow(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:A1`,
  })
  const val = res.data.values?.[0]?.[0] ?? ""
  if (val !== "Listing ID") {
    console.log("  Writing header row…")
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:${colLetter(TOTAL_COLS - 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] },
    })
  }
}

/** Read all data rows from the sheet. Returns array of { rowNum, values[] } */
async function readAllSheetRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:${colLetter(TOTAL_COLS - 1)}`,
  })
  const rows = res.data.values ?? []
  // rows[0] is header; rows[1..] are data
  const dataRows = []
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    // Pad to TOTAL_COLS length
    while (values.length < TOTAL_COLS) values.push("")
    dataRows.push({ rowNum: i + 1, values })
  }
  return dataRows
}

/** Append a new row at the end of the sheet data. */
async function appendRow(sheets, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  })
}

/** Update a single row in the sheet (1-based rowNum). */
async function updateRow(sheets, rowNum, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${rowNum}:${colLetter(TOTAL_COLS - 1)}${rowNum}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  })
}

// ── DB helpers ─────────────────────────────────────────────────────────────

/** Convert a sheet cell value to int, returning null if empty / invalid. */
function toInt(val) {
  if (val === "" || val == null) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10)
  return isNaN(n) ? null : n
}

/** Convert a sheet cell value to string, returning null if empty. */
function toStr(val) {
  const s = String(val ?? "").trim()
  return s === "" ? null : s
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== sync-sheet.mjs starting ===")

  // 1. Auth + Sheets client
  const auth = buildAuthClient()
  const sheets = google.sheets({ version: "v4", auth })

  // 2. Prisma
  const prisma = new PrismaClient()

  try {
    // ── Ensure the sheet tab exists ──────────────────────────────────────
    // If the tab doesn't exist yet, add it
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
    const existingSheets = spreadsheet.data.sheets ?? []
    const tabExists = existingSheets.some(
      (s) => s.properties?.title === SHEET_NAME
    )
    if (!tabExists) {
      console.log(`  Creating sheet tab "${SHEET_NAME}"…`)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      })
    }

    // ── Ensure header row ────────────────────────────────────────────────
    await ensureHeaderRow(sheets)

    // ── Load all active DB listings ──────────────────────────────────────
    console.log("  Loading DB listings…")
    const EXCLUDED_BUILDERS = ["Bonanni Development", "City Ventures"]
    const listings = await prisma.listing.findMany({
      where: {
        status: "active",
        community: { builder: { name: { notIn: EXCLUDED_BUILDERS } } },
      },
      include: {
        community: {
          include: { builder: true },
        },
      },
      orderBy: [
        { community: { builder: { name: "asc" } } },
        { community: { name: "asc" } },
        { address: "asc" },
      ],
    })
    console.log(`  Found ${listings.length} active listings in DB`)

    // ── Load existing sheet rows ─────────────────────────────────────────
    const sheetRows = await readAllSheetRows(sheets)
    console.log(`  Found ${sheetRows.length} existing data rows in sheet`)

    // Build a map: listingId → { rowNum, values }
    const sheetById = new Map()
    for (const row of sheetRows) {
      const id = row.values[0]
      if (id) sheetById.set(String(id), row)
    }

    // ── PHASE 1: DB → Sheet (push) ───────────────────────────────────────
    console.log("\n── Phase 1: DB → Sheet ──")
    let updated = 0
    let created = 0

    for (const listing of listings) {
      const idStr = String(listing.id)
      const freshRow = dbRow(listing)

      if (sheetById.has(idStr)) {
        // Row already exists: overwrite non-editable cols, preserve editable
        const existing = sheetById.get(idStr)
        const merged = mergeRow(freshRow, existing.values)

        // Only update if something actually changed (avoid quota usage)
        const changed = merged.some((v, i) => {
          if (USER_EDITABLE_COLS.has(i)) return false // skip editable
          return String(v) !== String(existing.values[i] ?? "")
        })

        if (changed) {
          await updateRow(sheets, existing.rowNum, merged)
          console.log(`  ↻ Updated row ${existing.rowNum} [${idStr}] ${listing.address}`)
          updated++
        }
      } else {
        // New listing: append row (editable cols seeded from DB)
        await appendRow(sheets, freshRow)
        console.log(`  + Added [${idStr}] ${listing.address} (${listing.community?.name})`)
        created++
      }
    }

    console.log(`  Push complete: ${created} added, ${updated} updated`)

    // ── PHASE 2: Sheet → DB (pull) ───────────────────────────────────────
    console.log("\n── Phase 2: Sheet → DB ──")

    // Re-read sheet to capture any rows we just appended
    const freshSheetRows = await readAllSheetRows(sheets)
    let pulled = 0

    for (const row of freshSheetRows) {
      const idStr = String(row.values[0] ?? "").trim()
      if (!idStr || isNaN(Number(idStr))) continue

      const listingId = parseInt(idStr, 10)

      // Read user-editable cells
      const sheetHoa      = toInt(row.values[11])   // L HOA
      const sheetTax      = toInt(row.values[12])   // M Annual Tax
      const sheetMoveIn   = toStr(row.values[13])   // N Move-In Date
      const sheetSchools  = toStr(row.values[17])   // R Schools
      const sheetNotes    = toStr(row.values[20])   // U Notes

      // Fetch current DB record for comparison
      const dbListing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          hoaFees: true,
          taxes: true,
          moveInDate: true,
          schools: true,
          incentives: true, // using incentives field for notes
        },
      })
      if (!dbListing) continue

      // Build update payload — only include fields that actually changed
      const updateData = {}

      if (sheetHoa !== null && sheetHoa !== dbListing.hoaFees) {
        updateData.hoaFees = sheetHoa
      }
      if (sheetTax !== null && sheetTax !== dbListing.taxes) {
        updateData.taxes = sheetTax
      }
      if (sheetMoveIn !== null && sheetMoveIn !== dbListing.moveInDate) {
        updateData.moveInDate = sheetMoveIn
      }
      if (sheetSchools !== null && sheetSchools !== dbListing.schools) {
        updateData.schools = sheetSchools
      }
      // Store notes in the incentives field (closest match in current schema)
      if (sheetNotes !== null && sheetNotes !== dbListing.incentives) {
        updateData.incentives = sheetNotes
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.listing.update({
          where: { id: listingId },
          data: updateData,
        })
        console.log(`  ← Pulled [${listingId}] ${JSON.stringify(updateData)}`)
        pulled++
      }
    }

    console.log(`  Pull complete: ${pulled} DB records updated from sheet`)

    console.log("\n=== sync-sheet.mjs done ===")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
