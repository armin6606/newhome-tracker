/**
 * send-daily-report.mjs
 * Runs after the 1 AM scrapers — sends "New Key Daily Report" to armin.sabe@gmail.com
 *
 * Sections:
 *   1. For-Sale Homes     : 11 PM count vs post-scrape count
 *   2. Scraper Activity   : New / Sold / Price Changes per builder
 *   3. Community Cards    : Placeholder counts before vs after (changed cards only)
 *   4. Sheet Table 2      : Count changes per community (before vs after)
 *   5. Other Changes      : New communities, scraper errors
 *
 * Depends on logs/nightly-snapshot.json written by snapshot-11pm.mjs at 11 PM.
 *
 * Run:      node scripts/send-daily-report.mjs
 * Schedule: Appended to 1 AM scraper task (runs after all scrapers finish)
 */

import { createRequire } from "module"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const require    = createRequire(import.meta.url)
const __dirname  = dirname(fileURLToPath(import.meta.url))

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

const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = "New Key <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"
const SITE_URL       = "https://www.newkey.us"

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const BUILDER_TABS = {
  "Toll Brothers":   "Toll Communities",
  "Lennar":          "Lennar Communities",
  "Pulte":           "Pulte Communities",
  "Taylor Morrison": "Taylor Communities",
  "Del Webb":        "Del Webb Communities",
  "KB Home":         "KB Communities",
  "Melia Homes":     "Melia Communities",
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n) {
  return n != null ? "$" + Number(n).toLocaleString() : "N/A"
}

function delta(after, before) {
  const d = after - before
  if (d === 0) return '<span style="color:#6b7280">±0</span>'
  return d > 0
    ? `<span style="color:#16a34a;font-weight:600">+${d}</span>`
    : `<span style="color:#dc2626;font-weight:600">${d}</span>`
}

function getMidnightPacific() {
  const offsetMs   = 7 * 60 * 60 * 1000 // PDT UTC-7
  const nowPacific = new Date(Date.now() - offsetMs)
  const midnight   = new Date(Date.UTC(
    nowPacific.getUTCFullYear(),
    nowPacific.getUTCMonth(),
    nowPacific.getUTCDate()
  ))
  return new Date(midnight.getTime() + offsetMs)
}

// ── CSV parser ──────────────────────────────────────────────────────────────────

function parseCSV(text) {
  return text.split("\n").map(line => {
    const cells = []; let cur = "", inQ = false
    for (const ch of line + ",") {
      if (ch === '"')                inQ = !inQ
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = "" }
      else                           cur += ch
    }
    return cells
  })
}

// ── Fetch Table 2 from a sheet tab ────────────────────────────────────────────

async function fetchTable2(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
  try {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok) return {}
    const rows = parseCSV(await res.text())
    const counts = {}
    for (const row of rows) {
      const name = row[3]?.trim()
      if (!name || name === "Table 2 Community" || name === "Table 2" || name === "Community") continue
      if (row[0]?.trim() === "Table 3") break
      const sold    = parseInt(row[4]) || 0
      const forSale = parseInt(row[5]) || 0
      const future  = parseInt(row[6]) || 0
      const total   = parseInt(row[7]) || 0
      if (sold === 0 && forSale === 0 && future === 0 && total === 0) continue
      counts[name] = { sold, forSale, future, total }
    }
    return counts
  } catch {
    return {}
  }
}

// ── Data collection ────────────────────────────────────────────────────────────

async function collectData(snapshot) {
  const since = getMidnightPacific()

  // Post-scrape for-sale count (real listings)
  const forSaleNow = await prisma.listing.count({
    where: { status: "active", address: { not: null } },
  })

  // Changes since midnight, with builder info
  const newListings = await prisma.listing.findMany({
    where:   { firstDetected: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: { select: { name: true } } } } },
    orderBy: { firstDetected: "desc" },
  })

  const newlySold = await prisma.listing.findMany({
    where:   { soldAt: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: { select: { name: true } } } } },
    orderBy: { soldAt: "desc" },
  })

  const priceChanges = await prisma.priceHistory.findMany({
    where:   { detectedAt: { gte: since } },
    include: { listing: { include: { community: { include: { builder: { select: { name: true } } } } } } },
    orderBy: { detectedAt: "desc" },
  })

  // Current community card counts (from placeholders)
  const communities = await prisma.community.findMany({
    include: {
      builder:  { select: { name: true } },
      listings: {
        where:  { address: null, status: { not: "removed" } },
        select: { status: true },
      },
    },
  })

  const communityCardsNow = {}
  for (const c of communities) {
    const ph = c.listings
    communityCardsNow[c.name] = {
      builder: c.builder.name,
      active:  ph.filter(l => l.status === "active").length,
      sold:    ph.filter(l => l.status === "sold").length,
      future:  ph.filter(l => l.status === "future").length,
      total:   ph.length,
    }
  }

  // Current Sheet Table 2
  const table2Now = {}
  for (const [builderName, tabName] of Object.entries(BUILDER_TABS)) {
    table2Now[builderName] = await fetchTable2(tabName)
  }

  return { since, forSaleNow, newListings, newlySold, priceChanges, communityCardsNow, table2Now }
}

// ── Group by builder ───────────────────────────────────────────────────────────

function groupByBuilder(items, getBuilder) {
  const map = {}
  for (const item of items) {
    const b = getBuilder(item)
    if (!map[b]) map[b] = []
    map[b].push(item)
  }
  return map
}

// ── HTML Sections ──────────────────────────────────────────────────────────────

const card = (content) =>
  `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:20px">${content}</div>`

const sectionHeader = (title) =>
  `<h2 style="margin:0 0 14px;font-size:16px;color:#111827;font-weight:700;border-bottom:2px solid #f3f4f6;padding-bottom:8px">${title}</h2>`

function statBoxes(boxes) {
  const items = boxes.map(({ label, value, color }) =>
    `<div style="flex:1;min-width:90px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:${color || "#111827"}">${value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px">${label}</div>
    </div>`
  ).join("")
  return `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">${items}</div>`
}

function table(headers, rows, emptyMsg) {
  if (rows.length === 0) {
    return `<p style="color:#9ca3af;font-size:13px;margin:0">${emptyMsg}</p>`
  }
  const headerRow = headers.map(h =>
    `<th style="padding:7px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;background:#f9fafb;white-space:nowrap">${h}</th>`
  ).join("")
  const bodyRows = rows.map(cells =>
    `<tr>${cells.map((c, i) =>
      `<td style="padding:7px 10px;border-top:1px solid #f3f4f6;font-size:13px;color:${i === 0 ? "#111827" : "#374151"};${i > 0 ? "white-space:nowrap" : ""}">${c ?? ""}</td>`
    ).join("")}</tr>`
  ).join("")
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`
}

// ── Section 1: For-Sale Homes ─────────────────────────────────────────────────

function section1ForSale(snapshot, forSaleNow) {
  const before = snapshot?.forSaleCount ?? "N/A"
  const d = typeof before === "number" ? (forSaleNow - before) : null
  const dStr = d === null ? "—" : d > 0 ? `<span style="color:#16a34a;font-weight:700">+${d}</span>` : d < 0 ? `<span style="color:#dc2626;font-weight:700">${d}</span>` : `<span style="color:#6b7280">±0</span>`
  return card(`
    ${sectionHeader("For-Sale Homes on Listing Page")}
    ${statBoxes([
      { label: "11 PM (before scrape)", value: before, color: "#6b7280" },
      { label: "After scrape", value: forSaleNow, color: "#2563eb" },
      { label: "Change", value: dStr, color: "#111827" },
    ])}
  `)
}

// ── Section 2: Scraper Activity per Builder ────────────────────────────────────

function section2ScraperActivity(newListings, newlySold, priceChanges) {
  const builders = Object.keys(BUILDER_TABS)
  const newByBuilder   = groupByBuilder(newListings,   l  => l.community.builder.name)
  const soldByBuilder  = groupByBuilder(newlySold,     l  => l.community.builder.name)
  const priceByBuilder = groupByBuilder(priceChanges,  pc => pc.listing.community.builder.name)

  const allChanged = builders.filter(b =>
    (newByBuilder[b]?.length || 0) + (soldByBuilder[b]?.length || 0) + (priceByBuilder[b]?.length || 0) > 0
  )
  const allUnchanged = builders.filter(b => !allChanged.includes(b))

  // Summary table
  const summaryRows = builders.map(b => {
    const n = newByBuilder[b]?.length  || 0
    const s = soldByBuilder[b]?.length || 0
    const p = priceByBuilder[b]?.length|| 0
    const status = n + s + p === 0
      ? `<span style="color:#9ca3af">No changes</span>`
      : `<span style="color:#16a34a">${n} new</span>  <span style="color:#dc2626">${s} sold</span>  <span style="color:#2563eb">${p} price</span>`
    return [b, status]
  })

  let detailSections = ""
  for (const b of allChanged) {
    const news  = newByBuilder[b]   || []
    const solds = soldByBuilder[b]  || []
    const prices= priceByBuilder[b] || []

    let detail = `<div style="margin-top:14px"><strong style="font-size:13px;color:#374151">${b}</strong>`

    if (news.length > 0) {
      const rows = news.map(l => [
        l.address,
        l.community.name,
        l.currentPrice ? fmt(l.currentPrice) : "—",
        l.moveInDate || "—",
      ])
      detail += `<div style="margin-top:8px;font-size:12px;color:#16a34a;font-weight:600">New Listings (${news.length})</div>`
      detail += table(["Address","Community","Price","Move-In"], rows, "")
    }

    if (solds.length > 0) {
      const rows = solds.map(l => [l.address, l.community.name, l.currentPrice ? fmt(l.currentPrice) : "—"])
      detail += `<div style="margin-top:8px;font-size:12px;color:#dc2626;font-weight:600">Newly Sold (${solds.length})</div>`
      detail += table(["Address","Community","Last Price"], rows, "")
    }

    if (prices.length > 0) {
      const rows = prices.map(pc => {
        const l = pc.listing
        const prev = pc.oldPrice ? fmt(pc.oldPrice) : "—"
        const curr = fmt(pc.price)
        const d2   = pc.oldPrice ? (pc.price - pc.oldPrice) : null
        const chg  = d2 !== null ? (d2 > 0 ? `<span style="color:#dc2626">+${fmt(d2)}</span>` : `<span style="color:#16a34a">${fmt(d2)}</span>`) : "—"
        return [l.address ?? l.lotNumber, l.community.name, prev, curr, chg]
      })
      detail += `<div style="margin-top:8px;font-size:12px;color:#2563eb;font-weight:600">Price Changes (${prices.length})</div>`
      detail += table(["Address","Community","Old Price","New Price","Change"], rows, "")
    }

    detail += `</div>`
    detailSections += detail
  }

  return card(`
    ${sectionHeader("Scraper Activity — What Changed per Builder")}
    ${table(["Builder","Result"], summaryRows, "No scrapers ran.")}
    ${detailSections}
  `)
}

// ── Section 3: Community Card Changes ─────────────────────────────────────────

function section3CommunityCards(snapshot, communityCardsNow) {
  const before = snapshot?.communityCards || {}
  const changed = []

  const allNames = new Set([...Object.keys(before), ...Object.keys(communityCardsNow)])
  for (const name of allNames) {
    const b4  = before[name]
    const now = communityCardsNow[name]
    if (!b4 && now) {
      changed.push({ name, builder: now.builder, change: "NEW COMMUNITY", b4: null, now })
      continue
    }
    if (b4 && !now) {
      changed.push({ name, builder: b4.builder, change: "REMOVED", b4, now: null })
      continue
    }
    if (b4 && now) {
      if (b4.active !== now.active || b4.sold !== now.sold || b4.future !== now.future) {
        changed.push({ name, builder: now.builder, change: "updated", b4, now })
      }
    }
  }

  if (changed.length === 0) {
    return card(`${sectionHeader("Community Card Changes")}
      <p style="color:#9ca3af;font-size:13px;margin:0">No community card changes detected.</p>`)
  }

  const rows = changed.map(c => {
    const tag = c.change === "NEW COMMUNITY"
      ? `<span style="background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">NEW</span>`
      : c.change === "REMOVED"
      ? `<span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">REMOVED</span>`
      : ""
    const forSaleBefore = c.b4  ? c.b4.active  : "—"
    const forSaleAfter  = c.now ? c.now.active  : "—"
    const soldBefore    = c.b4  ? c.b4.sold     : "—"
    const soldAfter     = c.now ? c.now.sold     : "—"
    const futureBefore  = c.b4  ? c.b4.future   : "—"
    const futureAfter   = c.now ? c.now.future   : "—"
    const fsDelta = (typeof forSaleBefore === "number" && typeof forSaleAfter === "number")
      ? delta(forSaleAfter, forSaleBefore) : "—"
    return [
      `${c.name} ${tag}`,
      c.builder,
      `${forSaleBefore} → ${forSaleAfter} (${fsDelta})`,
      `${soldBefore} → ${soldAfter}`,
      `${futureBefore} → ${futureAfter}`,
    ]
  })

  return card(`
    ${sectionHeader(`Community Card Changes (${changed.length})`)}
    ${table(["Community","Builder","For Sale","Sold","Future"], rows, "")}
  `)
}

// ── Section 4: Sheet Table 2 Changes ──────────────────────────────────────────

function section4Table2(snapshot, table2Now) {
  const before = snapshot?.table2 || {}
  const changed = []

  for (const [builderName, nowCounts] of Object.entries(table2Now)) {
    const beforeCounts = before[builderName] || {}
    const allComms = new Set([...Object.keys(beforeCounts), ...Object.keys(nowCounts)])
    for (const commName of allComms) {
      const b4  = beforeCounts[commName]
      const now = nowCounts[commName]
      if (!b4 && now) {
        changed.push({ builder: builderName, community: commName, b4: null, now })
        continue
      }
      if (b4 && !now) {
        changed.push({ builder: builderName, community: commName, b4, now: null })
        continue
      }
      if (b4 && now) {
        if (b4.sold !== now.sold || b4.forSale !== now.forSale || b4.future !== now.future || b4.total !== now.total) {
          changed.push({ builder: builderName, community: commName, b4, now })
        }
      }
    }
  }

  if (changed.length === 0) {
    return card(`${sectionHeader("Sheet Table 2 Changes")}
      <p style="color:#9ca3af;font-size:13px;margin:0">No changes detected in Google Sheet Table 2.</p>`)
  }

  const rows = changed.map(c => {
    const fs = c.b4 && c.now
      ? `${c.b4.forSale} → ${c.now.forSale} (${delta(c.now.forSale, c.b4.forSale)})`
      : c.now ? `— → ${c.now.forSale}` : `${c.b4.forSale} → removed`
    const sold = c.b4 && c.now
      ? `${c.b4.sold} → ${c.now.sold} (${delta(c.now.sold, c.b4.sold)})`
      : c.now ? `— → ${c.now.sold}` : `${c.b4.sold} → removed`
    const future = c.b4 && c.now
      ? `${c.b4.future} → ${c.now.future} (${delta(c.now.future, c.b4.future)})`
      : c.now ? `— → ${c.now.future}` : `${c.b4.future} → removed`
    const total = c.b4 && c.now
      ? `${c.b4.total} → ${c.now.total}`
      : c.now ? `${c.now.total}` : `removed`
    return [c.community, c.builder, fs, sold, future, total]
  })

  return card(`
    ${sectionHeader(`Sheet Table 2 Changes (${changed.length})`)}
    ${table(["Community","Builder","For Sale","Sold","Future Release","Total"], rows, "")}
  `)
}

// ── Section 5: Other Changes ───────────────────────────────────────────────────

function section5Other(snapshot, communityCardsNow, table2Now) {
  // New communities that appear in DB now but weren't in snapshot
  const before     = Object.keys(snapshot?.communityCards || {})
  const now        = Object.keys(communityCardsNow)
  const newComms   = now.filter(n => !before.includes(n))
  const goneComms  = before.filter(n => !now.includes(n))

  // Total site-wide counts now
  const totalActive = Object.values(communityCardsNow).reduce((s, c) => s + c.active, 0)
  const totalSold   = Object.values(communityCardsNow).reduce((s, c) => s + c.sold, 0)
  const totalFuture = Object.values(communityCardsNow).reduce((s, c) => s + c.future, 0)

  let extras = ""
  if (newComms.length > 0) {
    extras += `<div style="margin-top:12px"><strong style="font-size:13px">New Communities on Site (${newComms.length})</strong>
      <ul style="margin:6px 0 0;padding-left:18px">${newComms.map(n => `<li style="font-size:13px;color:#374151">${n}</li>`).join("")}</ul></div>`
  }
  if (goneComms.length > 0) {
    extras += `<div style="margin-top:12px"><strong style="font-size:13px;color:#dc2626">Communities Removed from Site (${goneComms.length})</strong>
      <ul style="margin:6px 0 0;padding-left:18px">${goneComms.map(n => `<li style="font-size:13px;color:#374151">${n}</li>`).join("")}</ul></div>`
  }
  if (!extras) extras = `<p style="color:#9ca3af;font-size:13px;margin:12px 0 0">No other changes detected.</p>`

  return card(`
    ${sectionHeader("Other Website Changes")}
    ${statBoxes([
      { label: "For Sale (site total)", value: totalActive, color: "#2563eb" },
      { label: "Sold (site total)",     value: totalSold,   color: "#dc2626" },
      { label: "Future (site total)",   value: totalFuture, color: "#6b7280" },
    ])}
    ${extras}
  `)
}

// ── Build full HTML email ──────────────────────────────────────────────────────

function buildHtml(snapshot, data) {
  const { forSaleNow, newListings, newlySold, priceChanges, communityCardsNow, table2Now } = data
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })
  const snapshotTime = snapshot
    ? new Date(snapshot.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "unavailable"

  const s1 = section1ForSale(snapshot, forSaleNow)
  const s2 = section2ScraperActivity(newListings, newlySold, priceChanges)
  const s3 = section3CommunityCards(snapshot, communityCardsNow)
  const s4 = section4Table2(snapshot, table2Now)
  const s5 = section5Other(snapshot, communityCardsNow, table2Now)

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;margin:0;padding:24px">
  <div style="max-width:660px;margin:0 auto">

    <!-- Header -->
    <div style="background:#1e3a5f;border-radius:10px 10px 0 0;padding:20px 24px">
      <div style="color:white;font-size:20px;font-weight:700">New Key Daily Report</div>
      <div style="color:#93c5fd;font-size:13px;margin-top:4px">${dateStr}</div>
      <div style="color:#64748b;font-size:11px;margin-top:2px">11 PM snapshot: ${snapshotTime}</div>
    </div>

    <!-- Body -->
    <div style="background:#f3f4f6;padding:16px 0">
      ${s1}
      ${s2}
      ${s3}
      ${s4}
      ${s5}
    </div>

    <!-- Footer -->
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 10px 10px;padding:14px 20px;text-align:center">
      <a href="${SITE_URL}/communities" style="color:#2563eb;font-size:13px;text-decoration:none;font-weight:600">View All Communities on NewKey.us</a>
      <p style="margin:6px 0 0;font-size:11px;color:#9ca3af">Automated daily report · New Key · newkey.us</p>
    </div>
  </div>
</body>
</html>`
}

// ── Send via Resend ────────────────────────────────────────────────────────────

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
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log(` New Key Daily Report — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  // Load 11 PM snapshot (may not exist on first run)
  const snapshotPath = resolve(__dirname, "../logs/nightly-snapshot.json")
  let snapshot = null
  if (existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"))
      console.log(`  Snapshot loaded from ${snapshot.timestamp}`)
    } catch {
      console.warn("  Warning: could not parse snapshot file — running without it")
    }
  } else {
    console.warn("  Warning: no snapshot file found — 11 PM baseline will be unavailable")
  }

  console.log("\n  Collecting post-scrape data…")
  const data = await collectData(snapshot)

  const { forSaleNow, newListings, newlySold, priceChanges } = data
  console.log(`  For sale now  : ${forSaleNow} (was ${snapshot?.forSaleCount ?? "N/A"} at 11 PM)`)
  console.log(`  New listings  : ${newListings.length}`)
  console.log(`  Newly sold    : ${newlySold.length}`)
  console.log(`  Price changes : ${priceChanges.length}`)

  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const subject = `New Key Daily Report — ${dateStr}`
  const html    = buildHtml(snapshot, data)

  console.log(`\n  Sending to ${TO}…`)
  const result = await sendEmail(subject, html)
  console.log(`  ✓ Sent — id: ${result.id}`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`  Elapsed: ${elapsed}s`)
  console.log("=".repeat(60))
}

main()
  .catch(err => { console.error("Fatal:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
