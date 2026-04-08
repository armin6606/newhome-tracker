/**
 * scripts/cleanup-bad-communities.mjs
 *
 * One-time cleanup:
 *   1. Merges duplicate builder records (e.g. "Pulte Homes" → "Pulte")
 *   2. Deletes communities not found in any builder's Google Sheet Table 2
 *   3. Deletes now-empty builder records
 *
 * Run with: node --env-file=.env.local scripts/cleanup-bad-communities.mjs
 * Pass --dry-run to preview without making changes.
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")

if (DRY_RUN) console.log("=== DRY RUN — no changes will be made ===\n")

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"

const BUILDER_SHEET_TABS = {
  "Toll Brothers":          "Toll Communities",
  "Lennar":                 "Lennar Communities",
  "Pulte":                  "Pulte Communities",
  "Taylor Morrison":        "Taylor Communities",
  "Del Webb":               "Del Webb Communities",
  "KB Home":                "KB Communities",
  "Melia Homes":            "Melia Communities",
  "Shea Homes":             "Shea Communities",
  "Brookfield Residential": "Brookfield Communities",
}
const CANONICAL_BUILDERS = Object.keys(BUILDER_SHEET_TABS)

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"') inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else cur += ch
    }
    return cells
  })
}

async function fetchSheetCommunities(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const rows = parseCSV(await res.text())
    const names = new Set()
    let inTable2 = false
    for (const row of rows) {
      const col0 = row[0]?.trim() ?? ""
      const col3 = row[3]?.trim() ?? ""
      if (col0 === "Table 3") break
      if (col3 === "Table 2 Community" || col3 === "Community") { inTable2 = true; continue }
      if (inTable2 && col3) names.add(col3)
    }
    const TOLL_SENTINEL = new Set(["Elm Collection","Rowan Collection","Pinnacle","Skyline","Birch"])
    if (tabName !== "Toll Communities") {
      for (const n of names) { if (TOLL_SENTINEL.has(n)) return null }
    }
    return names.size > 0 ? names : null
  } catch { return null }
}

function normalizeBuilderName(raw) {
  const lower = raw.trim().toLowerCase()
  if (CANONICAL_BUILDERS.includes(raw.trim())) return raw.trim()
  const ci = CANONICAL_BUILDERS.find(b => b.toLowerCase() === lower)
  if (ci) return ci
  const contains = CANONICAL_BUILDERS.find(b => lower.includes(b.toLowerCase()))
  if (contains) return contains
  const within = CANONICAL_BUILDERS.find(b => b.toLowerCase().includes(lower))
  if (within) return within
  const fw = lower.split(/\s+/)[0]
  return CANONICAL_BUILDERS.find(b => b.toLowerCase().startsWith(fw)) ?? null
}

async function main() {
  console.log("Fetching Google Sheet data...\n")
  const sheetMap = {}
  for (const [builder, tab] of Object.entries(BUILDER_SHEET_TABS)) {
    sheetMap[builder] = await fetchSheetCommunities(tab) ?? new Set()
    console.log(`  ${builder}: ${sheetMap[builder].size} communities`)
  }
  console.log()

  // ── Step 1: Merge duplicate builder names ─────────────────────────────────
  console.log("=== Step 1: Merge duplicate builder names ===")
  const allBuilders = await prisma.builder.findMany()
  for (const builder of allBuilders) {
    const canonical = normalizeBuilderName(builder.name)
    if (!canonical || canonical === builder.name) continue
    const canonicalRecord = await prisma.builder.findUnique({ where: { name: canonical } })
    if (!canonicalRecord) { console.log(`  [SKIP] "${canonical}" not in DB yet`); continue }

    const communities = await prisma.community.findMany({ where: { builderId: builder.id } })
    console.log(`  Merging "${builder.name}" → "${canonical}" (${communities.length} communities)`)

    for (const comm of communities) {
      const dupe = await prisma.community.findUnique({
        where: { builderId_name: { builderId: canonicalRecord.id, name: comm.name } },
      })
      if (dupe) {
        const n = await prisma.listing.count({ where: { communityId: comm.id } })
        console.log(`    "${comm.name}" already exists — re-assigning ${n} listings, deleting duplicate`)
        if (!DRY_RUN) {
          await prisma.listing.updateMany({ where: { communityId: comm.id }, data: { communityId: dupe.id } })
          await prisma.community.delete({ where: { id: comm.id } })
        }
      } else {
        console.log(`    Moving community "${comm.name}" to "${canonical}"`)
        if (!DRY_RUN) {
          await prisma.community.update({ where: { id: comm.id }, data: { builderId: canonicalRecord.id } })
        }
      }
    }

    if (!DRY_RUN) {
      const remaining = await prisma.community.count({ where: { builderId: builder.id } })
      if (remaining === 0) {
        await prisma.builder.delete({ where: { id: builder.id } })
        console.log(`  Deleted empty builder "${builder.name}"`)
      }
    }
  }

  // ── Step 2: Delete communities not in Google Sheet ────────────────────────
  console.log("\n=== Step 2: Delete communities not in Google Sheet ===")
  const allComms = await prisma.community.findMany({ include: { builder: true } })

  for (const comm of allComms) {
    const canonical = normalizeBuilderName(comm.builder.name)
    const sheetComms = canonical ? sheetMap[canonical] : null

    if (!sheetComms || !sheetComms.has(comm.name)) {
      const n = await prisma.listing.count({ where: { communityId: comm.id } })
      const reason = !sheetComms ? "unknown builder" : "not in sheet"
      console.log(`  [${reason.toUpperCase()}] "${comm.builder.name}" / "${comm.name}" (${n} listings) — deleting`)
      if (!DRY_RUN) {
        await prisma.priceHistory.deleteMany({ where: { listing: { communityId: comm.id } } })
        await prisma.userFavorite.deleteMany({ where: { listing: { communityId: comm.id } } })
        await prisma.communityFollow.deleteMany({ where: { communityId: comm.id } })
        await prisma.listing.deleteMany({ where: { communityId: comm.id } })
        await prisma.community.delete({ where: { id: comm.id } })
      }
    }
  }

  // ── Step 3: Delete empty builders ─────────────────────────────────────────
  console.log("\n=== Step 3: Delete empty builder records ===")
  const builders = await prisma.builder.findMany({ include: { _count: { select: { communities: true } } } })
  for (const b of builders) {
    if (b._count.communities === 0) {
      console.log(`  Deleting empty builder "${b.name}"`)
      if (!DRY_RUN) await prisma.builder.delete({ where: { id: b.id } })
    }
  }

  console.log("\nDone.")
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
