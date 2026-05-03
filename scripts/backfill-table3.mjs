/**
 * backfill-table3.mjs
 *
 * One-time (and re-runnable) script that reads Table 3 from each builder's
 * Google Sheet and fills in missing beds/sqft/baths/floors/propertyType/
 * hoaFees/taxes/moveInDate for existing listings.
 *
 * Only fills NULL fields — never overwrites existing data.
 * Sends an email report with what was filled and what's still missing.
 *
 * Run: node scripts/backfill-table3.mjs
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
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

const SHEET_ID       = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const ALERT_EMAIL    = "armin.sabe@gmail.com"

// Builder → sheet tab name (must match sheet-validator.ts)
const BUILDER_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v) {
  if (!v) return null
  const n = parseFloat(String(v).replace(/[,$\s]/g, ""))
  return isNaN(n) ? null : n
}

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

function planKey(community, floorplan) {
  return `${community.toLowerCase().trim()}|${floorplan.toLowerCase().trim()}`
}

const EXTERIOR_SUFFIX_RE = /\s+(Mid-Century Modern|Modern Farmhouse|California Modern|Modern Hacienda|Coastal Contemporary|Contemporary Craftsman|Prairie|Transitional|Contemporary|Coastal|Modern|Farmhouse|Craftsman|Tuscan|Italianate|Spanish|Hacienda)$/i

function normalizePlan(communityName, planName) {
  if (!planName) return null
  let s = planName.trim()
  s = s.replace(/^Plan\s+/i, "")
  // Strip community name with spaces (e.g. "Ridge View ")
  const escaped = communityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  s = s.replace(new RegExp(`^${escaped}\\s+`, "i"), "")
  // Strip community name with spaces collapsed (e.g. "Ridgeview " for "Ridge View")
  const collapsed = communityName.replace(/\s+/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (collapsed) s = s.replace(new RegExp(`^${collapsed}\\s+`, "i"), "").trim()
  // Strip first word of community name (e.g. "Ridge " for "Ridge View")
  const firstWord = (communityName.split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (firstWord) s = s.replace(new RegExp(`^${firstWord}\\s+`, "i"), "").trim()
  const m = s.match(/^(\d+)([A-Za-z]*)/)
  if (!m) {
    // Non-digit plan: strip exterior style suffixes (e.g. "Melina Prairie" → "Melina")
    let base = s.trim()
    let prev = ""
    while (prev !== base) { prev = base; base = base.replace(EXTERIOR_SUFFIX_RE, "").trim() }
    return base || planName.trim()
  }
  return m[1] + (/x/i.test(m[2]) ? "X" : "")
}

function matchPlanBySpecs(plans, community, sqft, beds, baths) {
  if (!sqft) return null
  const SQFT_TOLERANCE = 50
  const prefix = community.toLowerCase().trim() + "|"
  const seen = new Set()
  const candidates = []
  for (const [key, plan] of plans) {
    if (!key.startsWith(prefix)) continue
    if (plan.sqft == null) continue
    if (Math.abs(plan.sqft - sqft) > SQFT_TOLERANCE) continue
    if (seen.has(plan.planName)) continue  // deduplicate — normalized keys alias the same plan
    seen.add(plan.planName)
    candidates.push({ planName: plan.planName, plan })
  }
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const narrowed = candidates.filter(c => {
    if (beds  != null && c.plan.beds  != null && c.plan.beds  !== beds)  return false
    if (baths != null && c.plan.baths != null && c.plan.baths !== baths) return false
    return true
  })
  return narrowed.length === 1 ? narrowed[0] : null
}

async function fetchTable3(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  const plans = new Map()
  try {
    const res  = await fetch(url, { redirect: "follow" })
    if (!res.ok) { console.error(`  Sheet fetch failed (${res.status}) for tab "${tabName}"`); return plans }
    const rows = parseCSV(await res.text())
    let inTable3 = false
    for (const row of rows) {
      const col0 = row[0]?.trim() ?? ""
      if (col0 === "Table 3")                          { inTable3 = true; continue }
      if (!inTable3)                                   continue
      if (col0 === "Community" || col0 === "Table 4") continue
      if (!col0)                                       continue
      const community = col0
      const floorplan = row[2]?.trim() ?? ""
      if (!floorplan) continue
      const planData = {
        planName:     floorplan,
        propertyType: row[3]?.trim()  || null,
        floors:       parseNum(row[4]),
        sqft:         parseNum(row[5]),
        beds:         parseNum(row[6]),
        baths:        parseNum(row[7]),
        moveInDate:   row[8]?.trim()  || null,
        hoaFees:      parseNum(row[9]),
        taxes:        row[10]?.trim()  || null,
      }
      plans.set(planKey(community, floorplan), planData)
      // Also store under normalized key so variant plan names resolve correctly
      const nk = normalizePlan(community, floorplan)
      if (nk && nk.toLowerCase() !== floorplan.toLowerCase().trim()) {
        plans.set(planKey(community, nk), planData)
      }
    }
  } catch (err) {
    console.error(`  Error reading Table 3 for "${tabName}":`, err.message)
  }
  return plans
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log(` Table 3 Backfill — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  const summary  = []   // per-builder results
  const allMissing = [] // { builder, community, floorPlan } not in Table 3
  let totalFilled = 0
  let totalSkipped = 0

  for (const [builderName, tabName] of Object.entries(BUILDER_TABS)) {
    console.log(`\n── ${builderName} (tab: ${tabName})`)

    // 1. Load Table 3 for this builder
    const plans = await fetchTable3(tabName)
    console.log(`   Table 3: ${plans.size} floorplan(s) loaded`)

    // 2. Get all real listings for this builder that have at least one null Table-3 field.
    //    Includes listings without floorPlan (spec matching will be attempted via sqft).
    const builder = await prisma.builder.findUnique({ where: { name: builderName } })
    if (!builder) { console.log(`   Builder not in DB — skipping`); continue }

    const listings = await prisma.listing.findMany({
      where: {
        address: { not: null },      // real listings only
        community: { builderId: builder.id },
      },
      include: { community: { select: { name: true } } },
    })

    console.log(`   Listings to sync: ${listings.length}`)

    let filled  = 0
    let missing = 0

    for (const listing of listings) {
      const communityName = listing.community.name
      const floorPlan     = listing.floorPlan

      let plan = null
      let resolvedFloorPlan = floorPlan

      if (floorPlan) {
        // Named lookup — try exact first, then normalized
        plan = plans.get(planKey(communityName, floorPlan))
        if (!plan) {
          const nk = normalizePlan(communityName, floorPlan)
          if (nk) plan = plans.get(planKey(communityName, nk))
        }
        // If still no match and sqft is available, fall through to spec-based
        if (!plan && listing.sqft) {
          const match = matchPlanBySpecs(plans, communityName, listing.sqft, listing.beds, listing.baths)
          if (match) { plan = match.plan; resolvedFloorPlan = match.planName }
        }
      } else if (listing.sqft) {
        // Spec-based match when no plan name (e.g. KB Home)
        const match = matchPlanBySpecs(plans, communityName, listing.sqft, listing.beds, listing.baths)
        if (match) {
          plan = match.plan
          resolvedFloorPlan = match.planName
        }
      }

      if (!plan) {
        missing++
        allMissing.push({ builder: builderName, community: communityName, floorPlan: floorPlan || "(no plan — spec match failed)" })
        continue
      }

      // Build update: Table 3 is always the source of truth — always overwrite
      const update = {}
      if (listing.floorPlan    == null && resolvedFloorPlan != null) update.floorPlan    = resolvedFloorPlan
      if (plan.beds         != null) update.beds         = plan.beds
      if (plan.sqft         != null) update.sqft         = plan.sqft
      if (plan.baths        != null) update.baths        = plan.baths
      if (plan.floors       != null) update.floors       = plan.floors
      if (plan.propertyType != null) update.propertyType = plan.propertyType
      if (plan.hoaFees      != null) update.hoaFees      = plan.hoaFees
      if (plan.taxes        != null) update.taxes        = plan.taxes
      if (listing.moveInDate == null && plan.moveInDate != null) update.moveInDate = plan.moveInDate

      // Also recalculate pricePerSqft if price + sqft are now both available
      const sqft = update.sqft ?? listing.sqft
      if (listing.currentPrice && sqft) {
        update.pricePerSqft = Math.round(listing.currentPrice / sqft)
      }

      if (Object.keys(update).length === 0) continue // nothing to update

      await prisma.listing.update({ where: { id: listing.id }, data: update })
      filled++
      console.log(`   ✓ ${communityName} — ${floorPlan} (${listing.address}): filled ${Object.keys(update).join(", ")}`)
    }

    totalFilled  += filled
    totalSkipped += missing
    summary.push({ builder: builderName, filled, missing })

    console.log(`   → Filled: ${filled} | Missing from Table 3: ${missing}`)
  }

  await prisma.$disconnect()

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60))
  console.log(` Backfill Summary`)
  console.log("=".repeat(60))
  for (const s of summary) {
    console.log(`  ${s.builder}: ${s.filled} filled, ${s.missing} missing`)
  }
  console.log(`\n  Total filled  : ${totalFilled}`)
  console.log(`  Total missing : ${totalSkipped}`)

  if (allMissing.length > 0) {
    console.log(`\n  Missing floorplans (not in Table 3):`)
    for (const m of allMissing) {
      console.log(`    • ${m.builder} › ${m.community} › ${m.floorPlan}`)
    }
  }

  // ── Table 3 Validation Checkpoint ────────────────────────────────────────
  console.log("\n" + "=".repeat(60))
  console.log(` Table 3 Validation Checkpoint`)
  console.log("=".repeat(60))

  const driftRows = [] // { builder, community, address, floorPlan, field, dbVal, t3Val }
  let driftCount  = 0

  for (const [builderName, tabName] of Object.entries(BUILDER_TABS)) {
    const builder = await prisma.builder.findUnique({ where: { name: builderName } })
    if (!builder) continue

    const plans = await fetchTable3(tabName)
    if (plans.size === 0) continue

    const listings = await prisma.listing.findMany({
      where: {
        address:   { not: null },
        floorPlan: { not: null },
        community: { builderId: builder.id },
      },
      include: { community: { select: { name: true } } },
    })

    for (const listing of listings) {
      const plan = plans.get(planKey(listing.community.name, listing.floorPlan))
      if (!plan) continue

      const checks = [
        ["beds",         listing.beds,         plan.beds],
        ["sqft",         listing.sqft,         plan.sqft],
        ["baths",        listing.baths,        plan.baths],
        ["floors",       listing.floors,       plan.floors],
        ["propertyType", listing.propertyType, plan.propertyType],
        ["hoaFees",      listing.hoaFees,      plan.hoaFees],
        ["taxes",        listing.taxes,        plan.taxes],
      ]

      for (const [field, dbVal, t3Val] of checks) {
        if (t3Val == null) continue // no Table 3 value — skip
        const dbStr = dbVal == null ? "NULL" : String(dbVal)
        const t3Str = String(t3Val)
        if (dbStr !== t3Str) {
          driftCount++
          driftRows.push({ builder: builderName, community: listing.community.name, address: listing.address, floorPlan: listing.floorPlan, field, dbVal: dbStr, t3Val: t3Str })
          console.log(`   ⚠ ${listing.community.name} — ${listing.floorPlan} (${listing.address}): ${field} DB=${dbStr} ≠ T3=${t3Str}`)
        }
      }
    }
  }

  if (driftCount === 0) {
    console.log("  ✅ All DB values match Table 3 — no drift detected.")
  } else {
    console.log(`\n  ⚠ ${driftCount} drift(s) detected across ${driftRows.length} field(s).`)
  }

  // ── Send email report ─────────────────────────────────────────────────────
  try {
    const filledRows = summary.map(s =>
      `<tr><td>${s.builder}</td><td>${s.filled}</td><td style="color:${s.missing > 0 ? 'red' : 'green'}">${s.missing}</td></tr>`
    ).join("")

    const missingRows = allMissing.length > 0
      ? `<h3 style="color:red">⚠️ Floorplans Missing from Table 3</h3>
         <p>Add these to Table 3 and re-run this script:</p>
         <ul>${allMissing.map(m => `<li>${m.builder} › ${m.community} › <strong>${m.floorPlan}</strong></li>`).join("")}</ul>`
      : `<p style="color:green">✅ All floorplans found in Table 3 — no missing plans.</p>`

    const driftSection = driftCount > 0
      ? `<h3 style="color:red">⚠️ Validation Drift (${driftCount} field mismatches)</h3>
         <p>These DB values don't match Table 3 after backfill:</p>
         <table border="1" cellpadding="6" cellspacing="0">
           <thead><tr><th>Builder</th><th>Community</th><th>Address</th><th>Plan</th><th>Field</th><th>DB</th><th>Table 3</th></tr></thead>
           <tbody>${driftRows.map(r => `<tr><td>${r.builder}</td><td>${r.community}</td><td>${r.address}</td><td>${r.floorPlan}</td><td>${r.field}</td><td style="color:red">${r.dbVal}</td><td style="color:green">${r.t3Val}</td></tr>`).join("")}</tbody>
         </table>`
      : `<p style="color:green">✅ Validation passed — all DB values match Table 3.</p>`

    await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    "New Key <onboarding@resend.dev>",
        to:      [ALERT_EMAIL],
        subject: `New Key — Table 3 Backfill Complete (${totalFilled} filled, ${totalSkipped} missing)`,
        html: `
          <h2>Table 3 Backfill Report</h2>
          <table border="1" cellpadding="6" cellspacing="0">
            <thead><tr><th>Builder</th><th>Filled</th><th>Missing</th></tr></thead>
            <tbody>${filledRows}</tbody>
          </table>
          ${missingRows}
          ${driftSection}
          <p style="color:#888;font-size:12px">Run: node scripts/backfill-table3.mjs — ${new Date().toISOString()}</p>
        `,
      }),
    })
    console.log(`\n  Email report sent to ${ALERT_EMAIL}`)
  } catch (err) {
    console.error("\n  Failed to send email:", err.message)
  }

  console.log("=".repeat(60))
}

main().catch(err => { console.error("Fatal:", err); process.exit(1) })
