/**
 * monitor-data-quality.mjs
 * Daily data-quality check — runs automatically for 10 days from 2026-03-26.
 *
 * Checks:
 *   1. Wrong cities — communities whose city is "Irvine" but should be something else
 *   2. Missing propertyType — active listings with a real address but no Type
 *
 * Auto-fixes any issues found silently before surfacing results.
 *
 * Run: node scripts/monitor-data-quality.mjs
 */

import { createRequire } from "module"
const require = createRequire(import.meta.url)

// Load env from .env.local
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

// ── Known correct cities (cross-referenced with Google Sheet) ─────────────────
const KNOWN_CITIES = {
  // Lennar
  "Hazel":           "Fullerton",
  "Torrey":          "Fullerton",
  "Strata":          "Rancho Mission Viejo",
  "Sequoias":        "Lake Forest",
  "Evergreens":      "Lake Forest",
  // Add more here as corrections are confirmed from the Google Sheet
}

// ── Known propertyTypes per community (from Google Sheet Table 3) ─────────────
const LENNAR_SHEET_CSV = "https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/export?format=csv&gid=1235396983"

async function fetchLennarTypes() {
  const res  = await fetch(LENNAR_SHEET_CSV, { redirect: "follow" })
  const text = await res.text()
  const typeByComm = {}
  let inTable3 = false
  for (const line of text.split("\n")) {
    const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim())
    if (cols[0] === "Table 3") { inTable3 = true; continue }
    if (!inTable3) continue
    if (cols[0] === "Community") continue
    const comm = cols[0]
    const type = cols[3]
    if (comm && type && !typeByComm[comm]) typeByComm[comm] = type
  }
  return typeByComm
}

// ── Fix 1: Wrong cities ───────────────────────────────────────────────────────
async function fixCities() {
  const issues = []
  for (const [commName, correctCity] of Object.entries(KNOWN_CITIES)) {
    const community = await prisma.community.findFirst({
      where: { name: commName, city: { not: correctCity } },
      select: { id: true, name: true, city: true }
    })
    if (community) {
      await prisma.community.update({ where: { id: community.id }, data: { city: correctCity } })
      issues.push(`Fixed city: ${commName} ${community.city} → ${correctCity}`)
    }
  }
  return issues
}

// ── Fix 2: Missing propertyType ───────────────────────────────────────────────
async function fixPropertyTypes(sheetTypes) {
  const issues = []
  for (const [commName, propertyType] of Object.entries(sheetTypes)) {
    const result = await prisma.listing.updateMany({
      where: {
        address:      { not: null },
        propertyType: null,
        community:    { name: commName, builder: { name: "Lennar" } },
      },
      data: { propertyType },
    })
    if (result.count > 0) {
      issues.push(`Fixed propertyType: Lennar / ${commName} → ${propertyType} (${result.count} listings)`)
    }
  }
  return issues
}

// ── Check remaining issues after fixes ────────────────────────────────────────
async function checkRemaining() {
  const warnings = []

  // Communities still showing "Irvine" that are in KNOWN_CITIES
  for (const [commName, correctCity] of Object.entries(KNOWN_CITIES)) {
    const still = await prisma.community.findFirst({
      where: { name: commName, city: { not: correctCity } }
    })
    if (still) warnings.push(`WARN: ${commName} still has city="${still.city}", expected "${correctCity}"`)
  }

  // Any active listings with real address still missing propertyType
  const missing = await prisma.listing.count({
    where: { address: { not: null }, propertyType: null, status: "active" }
  })
  if (missing > 0) warnings.push(`WARN: ${missing} active listings still missing propertyType`)

  return warnings
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const today    = new Date()
  const startDay = new Date("2026-03-26")
  const endDay   = new Date("2026-04-05")
  endDay.setHours(23, 59, 59, 999)

  // Only run within the monitoring window
  if (today < startDay || today > endDay) {
    console.log(`[monitor] Outside monitoring window (2026-03-26 – 2026-04-05). Exiting.`)
    await prisma.$disconnect()
    return
  }

  console.log(`[monitor] ${today.toISOString()} — running data-quality checks`)

  // Fetch sheet types for Lennar
  let sheetTypes = {}
  try {
    sheetTypes = await fetchLennarTypes()
  } catch (e) {
    console.warn("[monitor] Could not fetch Lennar sheet types:", e.message)
  }

  const cityFixes = await fixCities()
  const typeFixes = await fixPropertyTypes(sheetTypes)
  const warnings  = await checkRemaining()

  const allFixed = [...cityFixes, ...typeFixes]

  if (allFixed.length > 0) {
    console.log("[monitor] Auto-fixed:")
    allFixed.forEach(m => console.log("  ✓", m))
  }

  if (warnings.length > 0) {
    console.error("[monitor] Remaining issues that need attention:")
    warnings.forEach(w => console.error("  !", w))
    process.exitCode = 1
  } else {
    console.log("[monitor] All quality checks passed.")
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error("[monitor] Fatal:", err)
  process.exit(1)
})
