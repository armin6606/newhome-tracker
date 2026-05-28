/**
 * send-daily-report.mjs
 * Runs after the 1 AM scrapers — sends "New Key Daily Report" to armin.sabe@gmail.com
 *
 * Sections:
 *   1. Scraper Status     : Pass/fail/timeout per builder
 *   2. Other Changes      : New communities, removed communities, Table 2 changes
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

// Load scraper run results written by lib/scraper/index.ts
function loadScraperResults() {
  const paths = ["/tmp/scrape-results.json", resolve(dirname(fileURLToPath(import.meta.url)), "../logs/scrape-results.json")]
  for (const p of paths) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, "utf8")) } catch {}
    }
  }
  return null
}

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

const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = `New Key <${process.env.RESEND_FROM_EMAIL || "info@newkey.us"}>`
const TO             = "armin.sabe@gmail.com"
const SITE_URL       = "https://www.newkey.us"

const SHEET_ID    = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const BUILDER_TABS = {
  "Toll Brothers":        "Toll",
  "Lennar":               "Lennar",
  "Pulte":                "Pulte",
  "Taylor Morrison":      "Taylor Morrison",
  "Del Webb":             "Del Webb",
  "KB Home":              "KB",
  "Melia Homes":          "Melia",
  "Shea Homes":           "Shea",
  "Brookfield Residential": "Brookfield Communities",
  "TRI Pointe Homes":    "TRI Pointe Communities",
  "Trumark":             "Trumark",
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n) {
  return n != null ? "$" + Number(n).toLocaleString() : "N/A"
}

function lotAddr(l) {
  const parts = []
  if (l.lotNumber) parts.push("Lot " + l.lotNumber)
  if (l.address && !/^(avail|sold|future|lot)-/i.test(l.address)) parts.push(l.address)
  return parts.join(" / ") || l.address || l.lotNumber || "—"
}

function delta(after, before) {
  const d = after - before
  if (d === 0) return '<span style="color:#6b7280">±0</span>'
  return d > 0
    ? `<span style="color:#16a34a;font-weight:600">+${d}</span>`
    : `<span style="color:#dc2626;font-weight:600">${d}</span>`
}

function getMidnightPacific() {
  // Get today's date string (YYYY-MM-DD) in Pacific time — handles PST/PDT automatically
  const todayPacific = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date())

  const [y, m, d] = todayPacific.split("-").map(Number)

  // Try UTC-7 (PDT) first, then UTC-8 (PST); pick whichever gives hour=0 in Pacific
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0))
    const pacificHour = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(candidate)
    if (parseInt(pacificHour) === 0) return candidate
  }

  // Should never reach here, but fall back to PST (UTC-8)
  return new Date(Date.UTC(y, m - 1, d, 8, 0, 0))
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
    where: { status: "for sale", address: { not: null }, currentPrice: { not: null } },
  })

  // Changes since midnight, with builder info
  // Exclude placeholder lots (sold-N, avail-N, future-N) — they're accounting entries, not real homes
  const PLACEHOLDER_FILTER = {
    NOT: [
      { address: { startsWith: "sold-" } },
      { address: { startsWith: "avail-" } },
      { address: { startsWith: "future-" } },
      { address: { startsWith: "lot-" } },
    ],
  }

  const newListings = await prisma.listing.findMany({
    where:   { firstDetected: { gte: since }, address: { not: null }, ...PLACEHOLDER_FILTER },
    include: { community: { include: { builder: { select: { name: true } } } } },
    orderBy: { firstDetected: "desc" },
  })

  const newlySold = await prisma.listing.findMany({
    where:   { status: "sold", soldAt: { gte: since }, address: { not: null }, ...PLACEHOLDER_FILTER },
    include: { community: { include: { builder: { select: { name: true } } } } },
    orderBy: { soldAt: "desc" },
  })

  const priceChanges = await prisma.priceHistory.findMany({
    where:   { detectedAt: { gte: since } },
    include: { listing: { include: { community: { include: { builder: { select: { name: true } } } } } } },
    orderBy: { detectedAt: "desc" },
  })

  const pendingPromoCount = await prisma.promoSubmission.count({
    where: { status: "pending" },
  })

  // Current community card counts (from real scraped listings only — no placeholders)
  const PLACEHOLDER_LOT_RE = /^(sold|avail|future)-\d+$/
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
      builder:  { select: { name: true } },
      listings: {
        where:  { address: { not: null }, status: { not: "removed" } },
        select: { status: true, lotNumber: true, currentPrice: true },
      },
    },
  })

  const communityCardsNow = {}
  for (const c of communities) {
    const real = c.listings.filter(l => !PLACEHOLDER_LOT_RE.test(l.lotNumber || ""))
    communityCardsNow[c.name] = {
      builder: c.builder.name,
      active:  real.filter(l => l.status === "for sale" && l.currentPrice !== null).length,
      sold:    real.filter(l => l.status === "sold").length,
      future:  real.filter(l => l.status === "future").length,
      total:   real.length,
    }
  }

  // Current Sheet Table 2
  const table2Now = {}
  for (const [builderName, tabName] of Object.entries(BUILDER_TABS)) {
    table2Now[builderName] = await fetchTable2(tabName)
  }

  return { since, forSaleNow, newListings, newlySold, priceChanges, pendingPromoCount, communityCardsNow, table2Now }
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
      `<td style="padding:7px 10px;border-top:1px solid #f3f4f6;font-size:13px;color:${i === 0 ? "#111827" : "#374151"};word-break:break-word">${c ?? ""}</td>`
    ).join("")}</tr>`
  ).join("")
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
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
  const builders = ALL_BUILDERS

  // Split price changes: initial (new release) vs actual increase/decrease
  const newReleases   = priceChanges.filter(pc => pc.changeType === "initial")
  const actualChanges = priceChanges.filter(pc => pc.changeType !== "initial")

  const newByBuilder      = groupByBuilder(newListings,   l  => l.community.builder.name)
  const soldByBuilder     = groupByBuilder(newlySold,     l  => l.community.builder.name)
  const releaseByBuilder  = groupByBuilder(newReleases,   pc => pc.listing.community.builder.name)
  const priceByBuilder    = groupByBuilder(actualChanges, pc => pc.listing.community.builder.name)

  // Summary table
  const summaryRows = builders.map(b => {
    const n  = newByBuilder[b]?.length     || 0
    const s  = soldByBuilder[b]?.length    || 0
    const r  = releaseByBuilder[b]?.length || 0
    const p  = priceByBuilder[b]?.length   || 0
    const status = n + s + r + p === 0
      ? `<span style="color:#9ca3af">No changes</span>`
      : [
          n ? `<span style="color:#16a34a">${n} new</span>`         : "",
          s ? `<span style="color:#dc2626">${s} sold</span>`        : "",
          r ? `<span style="color:#7c3aed">${r} released</span>`    : "",
          p ? `<span style="color:#2563eb">${p} price chg</span>`   : "",
        ].filter(Boolean).join("  ")
    return [b, status]
  })

  const statusBadge = (s) => {
    if (s === "for sale") return `<span style="background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">For Sale</span>`
    if (s === "sold")     return `<span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">Sold</span>`
    if (s === "future")   return `<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">Future</span>`
    return `<span style="color:#6b7280">${s || "—"}</span>`
  }

  // Combined flat tables — builder name in every row
  let detailSections = ""

  if (newListings.length > 0) {
    const rows = newListings.map(l => [
      l.community.builder.name,
      lotAddr(l),
      l.community.name,
      statusBadge(l.status),
      l.currentPrice ? fmt(l.currentPrice) : "—",
      l.moveInDate || "—",
    ])
    detailSections += `<div style="margin-top:14px;font-size:12px;color:#16a34a;font-weight:600">New Listings (${newListings.length})</div>`
    detailSections += table(["Builder","Address","Community","Status","Price","Move-In"], rows, "")
  }

  if (newlySold.length > 0) {
    const rows = newlySold.map(l => [
      l.community.builder.name,
      lotAddr(l),
      l.community.name,
      l.currentPrice ? fmt(l.currentPrice) : "—",
    ])
    detailSections += `<div style="margin-top:14px;font-size:12px;color:#dc2626;font-weight:600">Newly Sold (${newlySold.length})</div>`
    detailSections += table(["Builder","Address","Community","Last Price"], rows, "")
  }

  if (newReleases.length > 0) {
    const rows = newReleases.map(pc => {
      const l = pc.listing
      return [l.community.builder.name, lotAddr(l), l.community.name, fmt(pc.price)]
    })
    detailSections += `<div style="margin-top:14px;font-size:12px;color:#7c3aed;font-weight:600">New Releases — First Price Set (${newReleases.length})</div>`
    detailSections += table(["Builder","Address","Community","Price"], rows, "")
  }

  if (actualChanges.length > 0) {
    const rows = actualChanges.map(pc => {
      const l    = pc.listing
      const prev = pc.oldPrice ? fmt(pc.oldPrice) : "—"
      const curr = fmt(pc.price)
      const d2   = pc.oldPrice ? (pc.price - pc.oldPrice) : null
      const chg  = d2 !== null ? (d2 > 0 ? `<span style="color:#dc2626">+${fmt(d2)}</span>` : `<span style="color:#16a34a">${fmt(d2)}</span>`) : "—"
      return [l.community.builder.name, lotAddr(l), l.community.name, prev, curr, chg]
    })
    detailSections += `<div style="margin-top:14px;font-size:12px;color:#2563eb;font-weight:600">Price Changes (${actualChanges.length})</div>`
    detailSections += table(["Builder","Address","Community","Old Price","New Price","Change"], rows, "")
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

// ── Section 0: Scraper Run Status ─────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: "America/Los_Angeles",
  }) + " PDT"
}

function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return ""
  const secs = Math.round((new Date(endIso) - new Date(startIso)) / 1000)
  if (secs < 60) return ` (${secs}s)`
  return ` (${Math.floor(secs / 60)}m ${secs % 60}s)`
}

// All builders that must appear in the status table every day
const ALL_BUILDERS = [
  "Toll Brothers",
  "Lennar",
  "Pulte",
  "Del Webb",
  "KB Home",
  "Taylor Morrison",
  "Melia Homes",
  "Shea Homes",
  "Brookfield Residential",
  "TRI Pointe Homes",
  "Trumark",
]

function section0ScraperStatus(scraperResults) {
  const results = scraperResults || {}

  const rows = ALL_BUILDERS.map(builder => {
    const d = results[builder]
    if (!d) {
      return [
        `⬜ ${builder}`,
        `<span style="color:#9ca3af">No data</span>`,
        `<span style="color:#9ca3af">—</span>`,
      ]
    }
    const ok       = d.status === "success"
    const timedOut = d.status === "timeout"
    const icon     = ok ? "✅" : timedOut ? "⏱️" : "❌"
    const statusEl = ok
      ? `<span style="color:#16a34a;font-weight:600">Passed</span>`
      : timedOut
      ? `<span style="color:#f59e0b;font-weight:600">Timed Out</span>`
      : `<span style="color:#dc2626;font-weight:600">Failed</span>`
    const errEl = d.errors && d.errors.length > 0
      ? `<div style="font-size:11px;color:#dc2626;margin-top:3px">${d.errors.map(e => `• ${e}`).join("<br>")}</div>`
      : ""
    const timeEl = d.startedAt
      ? `<span style="color:#6b7280;font-size:11px">${fmtTime(d.startedAt)}${fmtDuration(d.startedAt, d.finishedAt)}</span>`
      : `<span style="color:#9ca3af">—</span>`
    return [
      `${icon} ${builder}`,
      statusEl + errEl,
      timeEl,
    ]
  })

  const anyFailed  = ALL_BUILDERS.some(b => results[b] && results[b].status === "failure")
  const anyTimeout = ALL_BUILDERS.some(b => results[b] && results[b].status === "timeout")
  const anyNoData  = ALL_BUILDERS.some(b => !results[b])
  const header = anyFailed
    ? `Scraper Run Status <span style="color:#dc2626;font-size:13px;font-weight:400">— failures detected</span>`
    : anyTimeout
    ? `Scraper Run Status <span style="color:#f59e0b;font-size:13px;font-weight:400">— timeout(s) detected</span>`
    : anyNoData
    ? `Scraper Run Status <span style="color:#f59e0b;font-size:13px;font-weight:400">— manual run (no timing data)</span>`
    : `Scraper Run Status <span style="color:#16a34a;font-size:13px;font-weight:400">— all passed</span>`

  return card(`
    ${sectionHeader(header)}
    ${table(["Builder", "Status", "Started / Duration (PDT)"], rows, "No results.")}
  `)
}

// ── Build full HTML email ──────────────────────────────────────────────────────

function sectionPendingPromos(pendingPromoCount) {
  const count = pendingPromoCount ?? 0
  const color = count > 0 ? "#d97706" : "#16a34a"
  const label = count === 1 ? "promo is" : "promos are"

  return card(`
    ${sectionHeader("Pending Promo Review")}
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.5">
      <strong style="color:${color}">${count}</strong> pending ${label} waiting for review.
      <a href="${SITE_URL}/admin/promos" style="color:#2563eb;font-weight:600;text-decoration:none">Open promo approval queue â†’</a>
    </p>
  `)
}

function buildHtml(snapshot, data, scraperResults, workflowRunUrl) {
  const { communityCardsNow, table2Now, pendingPromoCount } = data
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })
  const snapshotTime = snapshot
    ? new Date(snapshot.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "unavailable"

  const s0 = section0ScraperStatus(scraperResults)
  const sPromos = sectionPendingPromos(pendingPromoCount)
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
      ${workflowRunUrl ? `<div style="margin-top:6px"><a href="${workflowRunUrl}" style="color:#93c5fd;font-size:11px;text-decoration:underline">View GitHub Actions Run →</a></div>` : ""}
    </div>

    <!-- Body -->
    <div style="background:#f3f4f6;padding:16px 0">
      ${s0}
      ${sPromos}
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
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Resend error (${res.status}): ${text.slice(0, 300)}`)
  }
  if (!res.ok) throw new Error(`Resend error (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  console.log("=".repeat(60))
  console.log(` New Key Daily Report — ${new Date().toISOString()}`)
  console.log("=".repeat(60))

  // Load 11 PM snapshot — try DB first (works in GitHub Actions), fall back to file
  let snapshot = null
  try {
    const record = await prisma.dailySnapshot.findFirst({ orderBy: { createdAt: "desc" } })
    if (record) {
      snapshot = record.data
      console.log(`  Snapshot loaded from DB (${record.createdAt.toISOString()})`)
    }
  } catch {
    // DB read failed — try local file
    const snapshotPath = resolve(__dirname, "../logs/nightly-snapshot.json")
    if (existsSync(snapshotPath)) {
      try {
        snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"))
        console.log(`  Snapshot loaded from file (${snapshot.timestamp})`)
      } catch {
        console.warn("  Warning: could not parse snapshot file — running without it")
      }
    } else {
      console.warn("  Warning: no snapshot found — 11 PM baseline will be unavailable")
    }
  }

  // Load scraper run results (available in GitHub Actions, null when run manually)
  const scraperResults  = loadScraperResults()
  const workflowRunUrl  = process.env.WORKFLOW_RUN_URL || null
  const passCount       = scraperResults ? Object.values(scraperResults).filter(d => d.status === "success").length : null
  const failCount       = scraperResults ? Object.values(scraperResults).filter(d => d.status === "failure").length : null
  const timeoutCount    = scraperResults ? Object.values(scraperResults).filter(d => d.status === "timeout").length : null
  console.log(scraperResults
    ? `  Scraper results: ${passCount} passed, ${failCount} failed, ${timeoutCount} timed out`
    : "  Scraper results: not available (manual run)")

  console.log("\n  Collecting post-scrape data…")
  const data = await collectData(snapshot)

  const { forSaleNow, newListings, newlySold, priceChanges } = data
  console.log(`  For sale now  : ${forSaleNow} (was ${snapshot?.forSaleCount ?? "N/A"} at 11 PM)`)
  console.log(`  New listings  : ${newListings.length}`)
  console.log(`  Newly sold    : ${newlySold.length}`)
  console.log(`  Price changes : ${priceChanges.length}`)

  const dateStr    = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const issueCount = (failCount || 0) + (timeoutCount || 0)
  const subject    = issueCount > 0
    ? `⚠️ New Key Daily Report — ${dateStr} (${issueCount} scraper issue${issueCount > 1 ? "s" : ""})`
    : `✅ New Key Daily Report — ${dateStr}`
  const html       = buildHtml(snapshot, data, scraperResults, workflowRunUrl)

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
