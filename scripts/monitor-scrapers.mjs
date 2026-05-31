/**
 * monitor-scrapers.mjs
 * Runs after all scrapers complete. Detects anomalies and sends an immediate
 * alert email if anything looks wrong — separate from the daily report.
 *
 * Checks:
 *   1. Scraper hard failures (error in results)
 *   2. Community went from >5 active → 0 active (sudden wipeout)
 *   3. Active listings dropped >60% for a community with >5 active
 *   4. Community total dropped >40% (lots disappearing)
 *   5. Any community returning 0 total lots but had >10 in DB
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require   = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local
const envPath = resolve(__dirname, "../.env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.replace(/\r/, "").split("=")
    if (k && !k.startsWith("#") && v.length)
      process.env[k.trim()] = v.join("=").trim().replace(/^["']|["']$/g, "")
  }
}

const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM           = "New Key Alerts <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"
const WORKFLOW_URL   = process.env.WORKFLOW_RUN_URL || ""
const PLACEHOLDER_ADDRESS_RE = /^(?:lot|homesite|home\s*site|home-site|hs|site)\s*#?\s*[-:]?\s*[a-z0-9-]+$/i

// ── Load scraper results ──────────────────────────────────────────────────────

function loadScraperResults() {
  const paths = [
    "/tmp/scrape-results.json",
    resolve(__dirname, "../logs/scrape-results.json"),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")) } catch {}
    }
  }
  return {}
}

// ── Load 11 PM snapshot ───────────────────────────────────────────────────────

function loadSnapshot() {
  const paths = [
    resolve(__dirname, "../logs/nightly-snapshot.json"),
    "/tmp/nightly-snapshot.json",
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")) } catch {}
    }
  }
  return null
}

function communitySnapshotKey(builderName, communityName) {
  return `${builderName}::${communityName}`
}

function getSnapshotCommunityCard(snapshot, comm) {
  const cards = snapshot?.communityCards
  if (!cards) return null

  const exact = cards[communitySnapshotKey(comm.builder.name, comm.name)]
  if (exact) return exact

  // Backward compatibility for snapshots created before builder-qualified keys.
  // Only trust a name-only entry when it belongs to the same builder.
  const legacy = cards[comm.name]
  if (legacy && (!legacy.builder || legacy.builder === comm.builder.name)) return legacy

  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const issues = []
  const results = loadScraperResults()
  const snapshot = loadSnapshot()

  // ── Check 1: Scraper hard failures ────────────────────────────────────────
  for (const [builder, data] of Object.entries(results)) {
    if (data.status === "failure" && data.errors?.length > 0) {
      for (const err of data.errors) {
        issues.push({
          severity: "high",
          builder,
          message: `Scraper failure: ${err}`,
        })
      }
    }
    if (
      data.status === "success" &&
      Object.prototype.hasOwnProperty.call(data, "communities") &&
      Number(data.communities) === 0
    ) {
      issues.push({
        severity: "high",
        builder,
        message: "Scraper reported success but processed 0 communities",
      })
    }
  }

  // ── Check 2 & 3: Active listing drops ─────────────────────────────────────
  // Get current active counts from DB
  const communities = await prisma.community.findMany({
    where: {
      OR: [
        { lastScrapedAt: { not: null } },
        {
          listings: {
            none: { status: { in: ["for sale", "sold"] } },
          },
        },
      ],
    },
    include: {
      builder: { select: { name: true } },
      _count: {
        select: {
          listings: { where: { status: "for sale", address: { not: null }, currentPrice: { not: null } } },
        },
      },
    },
  })

  if (snapshot?.communityCards) {
    for (const comm of communities) {
      const before = getSnapshotCommunityCard(snapshot, comm)
      if (!before) continue

      const activeBefore = before.active ?? 0
      const activeNow    = comm._count.listings
      const totalBefore  = before.total ?? 0

      // Community wiped out: had >5 active, now has 0
      if (activeBefore > 5 && activeNow === 0) {
        issues.push({
          severity: "high",
          builder: comm.builder.name,
          message: `${comm.name}: active listings dropped from ${activeBefore} → 0`,
        })
      }
      // Big active drop: >60% decrease on communities with >5 active
      else if (activeBefore > 5 && activeNow < activeBefore * 0.4) {
        issues.push({
          severity: "medium",
          builder: comm.builder.name,
          message: `${comm.name}: active listings dropped ${activeBefore} → ${activeNow} (${Math.round((1 - activeNow / activeBefore) * 100)}% drop)`,
        })
      }

      // Total count dropped >40%
      const dbTotal = await prisma.listing.count({
        where: { communityId: comm.id, status: { not: "removed" } },
      })
      if (totalBefore > 10 && dbTotal < totalBefore * 0.6) {
        issues.push({
          severity: "high",
          builder: comm.builder.name,
          message: `${comm.name}: total listings dropped ${totalBefore} → ${dbTotal} (possible data loss)`,
        })
      }
    }
  }

  // ── Check 4: Zero-lot communities ─────────────────────────────────────────
  for (const comm of communities) {
    const dbTotal = await prisma.listing.count({
      where: { communityId: comm.id, status: { not: "removed" } },
    })
    if (dbTotal === 0) {
      // Only flag if this builder's scraper ran successfully
      const builderResult = results[comm.builder.name]
      if (builderResult && builderResult.status === "success") {
        // Check if this community ever had listings
        const hadListings = await prisma.listing.count({
          where: { communityId: comm.id },
        })
        if (hadListings > 10) {
          issues.push({
            severity: "medium",
            builder: comm.builder.name,
            message: `${comm.name}: 0 active lots in DB but scraper succeeded (possible scraper miss)`,
          })
        }
      }
    }
  }

  // Check 5: Priced active homes must have real street addresses.
  // Future lots may be placeholders, but active inventory with a price must
  // be visible on the public site and therefore needs a real address.
  const pricedPlaceholderRows = await prisma.listing.findMany({
    where: {
      status: "for sale",
      currentPrice: { not: null },
      address: { not: null },
      OR: [
        { address: { startsWith: "Lot " } },
        { address: { startsWith: "Homesite " } },
        { address: { startsWith: "Home Site " } },
        { address: { startsWith: "Home-Site " } },
        { address: { startsWith: "HS" } },
        { address: { startsWith: "Site " } },
      ],
    },
    select: {
      address: true,
      lotNumber: true,
      currentPrice: true,
      community: {
        select: {
          name: true,
          builder: { select: { name: true } },
        },
      },
    },
    take: 50,
  })

  const pricedPlaceholderByCommunity = new Map()
  for (const row of pricedPlaceholderRows) {
    if (!PLACEHOLDER_ADDRESS_RE.test(row.address || "")) continue
    const key = `${row.community.builder.name}::${row.community.name}`
    const entry = pricedPlaceholderByCommunity.get(key) ?? {
      builder: row.community.builder.name,
      community: row.community.name,
      count: 0,
      examples: [],
    }
    entry.count += 1
    if (entry.examples.length < 3) {
      entry.examples.push(`${row.address}${row.lotNumber ? ` / lot ${row.lotNumber}` : ""}`)
    }
    pricedPlaceholderByCommunity.set(key, entry)
  }

  for (const entry of pricedPlaceholderByCommunity.values()) {
    issues.push({
      severity: "high",
      builder: entry.builder,
      message: `${entry.community}: ${entry.count} priced active listing${entry.count === 1 ? "" : "s"} still have placeholder addresses (${entry.examples.join(", ")})`,
    })
  }

  await prisma.$disconnect()

  // ── No issues — exit silently ──────────────────────────────────────────────
  if (issues.length === 0) {
    console.log("✅ Monitoring: no anomalies detected")
    return
  }

  // ── Send alert ────────────────────────────────────────────────────────────
  console.log(`⚠️  Monitoring: ${issues.length} issue(s) detected — sending alert`)
  for (const i of issues) console.log(`  [${i.severity}] ${i.builder}: ${i.message}`)

  if (!RESEND_API_KEY) {
    console.warn("No RESEND_API_KEY — skipping alert email")
    return
  }

  const highCount   = issues.filter(i => i.severity === "high").length
  const mediumCount = issues.filter(i => i.severity === "medium").length

  const rows = issues.map(i => {
    const color = i.severity === "high" ? "#dc2626" : "#d97706"
    const badge = i.severity === "high" ? "🔴 HIGH" : "🟡 MEDIUM"
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">
          <span style="color:${color};font-weight:600;font-size:11px">${badge}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:13px">
          <strong>${i.builder}</strong>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:13px">
          ${i.message}
        </td>
      </tr>`
  }).join("")

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
      <div style="background:#dc2626;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">⚠️ New Key Scraper Alert</h1>
        <p style="color:#fecaca;margin:4px 0 0;font-size:13px">
          ${highCount} high + ${mediumCount} medium issue${issues.length !== 1 ? "s" : ""} detected after tonight's scraper run
        </p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase">Severity</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase">Builder</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase">Issue</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${WORKFLOW_URL ? `<p style="margin-top:20px"><a href="${WORKFLOW_URL}" style="color:#2563eb;font-size:13px">View GitHub Actions run →</a></p>` : ""}
        <p style="color:#9ca3af;font-size:12px;margin-top:16px">
          Sent immediately after the 1 AM scraper run. Check the daily report at 6 AM for full details.
        </p>
      </div>
    </div>`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      subject: `⚠️ New Key Alert: ${issues.length} scraper issue${issues.length !== 1 ? "s" : ""} detected`,
      html,
    }),
  })

  if (res.ok) {
    console.log("✅ Alert email sent")
  } else {
    const body = await res.text()
    console.error("❌ Failed to send alert email:", res.status, body)
  }
}

main().catch(err => {
  console.error("Monitor error:", err)
  process.exit(0) // Don't fail the workflow if monitoring itself errors
})
