/**
 * send-daily-report.mjs
 * 6 AM daily — queries DB for last 24h changes, emails summary to info@newkey.us
 *
 * Run:      node scripts/send-daily-report.mjs
 * Schedule: Windows Task Scheduler → "NewKey Daily Report" → 6:00 AM daily
 */

import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"

// Load .env.local when running as a standalone script
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\r\n]*)"?\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {}

const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = "New Key <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"

const prisma = new PrismaClient()

// ── Compute midnight Pacific time (PDT = UTC-7) ───────────────────────────────

function getMidnightPacific() {
  const pacificOffsetMs = 7 * 60 * 60 * 1000 // PDT UTC-7
  const nowPacific = new Date(Date.now() - pacificOffsetMs)
  const midnight = new Date(Date.UTC(
    nowPacific.getUTCFullYear(),
    nowPacific.getUTCMonth(),
    nowPacific.getUTCDate()
  ))
  return new Date(midnight.getTime() + pacificOffsetMs) // convert back to UTC
}

// ── Query changes since midnight ──────────────────────────────────────────────

async function getChanges() {
  const since = getMidnightPacific() // midnight Pacific = start of today

  // Count active listings BEFORE midnight = yesterday's snapshot
  const yesterdayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null }, firstDetected: { lt: since } },
  })

  // Count active listings NOW = after 1 AM scrape
  const todayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null } },
  })

  // New listings added since midnight
  const newListings = await prisma.listing.findMany({
    where: { firstDetected: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: true } } },
    orderBy: { firstDetected: "desc" },
  })

  // Homes sold since midnight
  const newlySold = await prisma.listing.findMany({
    where: { soldAt: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: true } } },
    orderBy: { soldAt: "desc" },
  })

  // Price changes since midnight
  const priceChanges = await prisma.priceHistory.findMany({
    where: { detectedAt: { gte: since } },
    include: { listing: { include: { community: { include: { builder: true } } } } },
    orderBy: { detectedAt: "desc" },
  })

  return { newListings, newlySold, priceChanges, since, todayTotal, yesterdayTotal }
}

// ── Format email ──────────────────────────────────────────────────────────────

function formatPrice(p) {
  return p ? "$" + p.toLocaleString() : "N/A"
}

function buildHtml({ newListings, newlySold, priceChanges, since, todayTotal, yesterdayTotal }) {
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  const hasChanges = newListings.length > 0 || newlySold.length > 0 || priceChanges.length > 0
  const delta = todayTotal - yesterdayTotal
  const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "no change"
  const deltaColor = delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#666"

  let body = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222">
      <div style="background:#1a1a1a;padding:20px 24px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;color:#fff;font-size:20px">New Key Daily Report</h1>
        <p style="margin:4px 0 0;color:#999;font-size:13px">${dateStr}</p>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e5e5;border-top:none">
        <div style="display:flex;gap:12px;margin-bottom:20px">
          <div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center">
            <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">Yesterday</div>
            <div style="font-size:28px;font-weight:700;color:#222;margin:4px 0">${yesterdayTotal}</div>
            <div style="font-size:11px;color:#999">active listings</div>
          </div>
          <div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center">
            <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">Today</div>
            <div style="font-size:28px;font-weight:700;color:#222;margin:4px 0">${todayTotal}</div>
            <div style="font-size:11px;color:#999">active listings</div>
          </div>
          <div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center">
            <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">Change</div>
            <div style="font-size:28px;font-weight:700;color:${deltaColor};margin:4px 0">${deltaStr}</div>
            <div style="font-size:11px;color:#999">from yesterday</div>
          </div>
        </div>
  `

  if (!hasChanges) {
    body += `<p style="color:#666;margin:0">✓ No changes detected in the last 24 hours.</p>`
  } else {

    // New Listings
    if (newListings.length > 0) {
      body += `<h2 style="font-size:15px;color:#1a1a1a;margin:0 0 10px">🆕 New Listings (${newListings.length})</h2><ul style="margin:0 0 20px;padding-left:18px">`
      for (const l of newListings) {
        body += `<li style="margin-bottom:6px">
          <strong>${l.address}</strong> — ${l.community.name} (${l.community.builder.name})
          ${l.currentPrice ? ` · ${formatPrice(l.currentPrice)}` : ""}
          ${l.beds ? ` · ${l.beds}bd` : ""}${l.baths ? `/${l.baths}ba` : ""}
          ${l.sqft ? ` · ${l.sqft.toLocaleString()} sqft` : ""}
        </li>`
      }
      body += `</ul>`
    }

    // Newly Sold
    if (newlySold.length > 0) {
      body += `<h2 style="font-size:15px;color:#1a1a1a;margin:0 0 10px">🔴 Newly Sold (${newlySold.length})</h2><ul style="margin:0 0 20px;padding-left:18px">`
      for (const l of newlySold) {
        body += `<li style="margin-bottom:6px">
          <strong>${l.address}</strong> — ${l.community.name} (${l.community.builder.name})
          ${l.currentPrice ? ` · Last price: ${formatPrice(l.currentPrice)}` : ""}
        </li>`
      }
      body += `</ul>`
    }

    // Price Changes
    if (priceChanges.length > 0) {
      body += `<h2 style="font-size:15px;color:#1a1a1a;margin:0 0 10px">💰 Price Changes (${priceChanges.length})</h2><ul style="margin:0 0 20px;padding-left:18px">`
      for (const pc of priceChanges) {
        const l = pc.listing
        if (!l.address) continue
        body += `<li style="margin-bottom:6px">
          <strong>${l.address}</strong> — ${l.community.name} (${l.community.builder.name})
          · ${pc.changeType} → ${formatPrice(pc.price)}
        </li>`
      }
      body += `</ul>`
    }
  }

  body += `
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0">
        <p style="font-size:12px;color:#999;margin:0">New Key · Changes since ${since.toLocaleString("en-US")}</p>
      </div>
    </div>
  `
  return body
}

function buildSubject() {
  return "Newkey Daily Report"
}

// ── Send via Resend ───────────────────────────────────────────────────────────

async function sendEmail(subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from: FROM, to: TO, subject, html }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Resend error (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60))
  console.log(` New Key Daily Report — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  const changes = await getChanges()
  const { newListings, newlySold, priceChanges, todayTotal, yesterdayTotal } = changes

  console.log(`  Yesterday     : ${yesterdayTotal} active listings`)
  console.log(`  Today         : ${todayTotal} active listings`)
  console.log(`  New listings  : ${newListings.length}`)
  console.log(`  Newly sold    : ${newlySold.length}`)
  console.log(`  Price changes : ${priceChanges.length}`)

  const subject = buildSubject()
  const html    = buildHtml(changes)

  console.log(`\n  Sending to ${TO} …`)
  const result = await sendEmail(subject, html)
  console.log(`  ✓ Sent — id: ${result.id}`)
  console.log("=".repeat(60))
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
