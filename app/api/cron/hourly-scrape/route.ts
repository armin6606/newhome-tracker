import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = "New Key <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"
const PDT_OFFSET_MS  = 7 * 60 * 60 * 1000 // UTC-7

// ── helpers ────────────────────────────────────────────────────────────────

function nowPdt() {
  return new Date(Date.now() - PDT_OFFSET_MS)
}
function pdtHour()  { return nowPdt().getUTCHours() }
function pdtDate()  { return nowPdt().toISOString().split("T")[0] }
function fmtTime(h: number) {
  if (h === 0)  return "12 AM"
  if (h < 12)  return `${h} AM`
  if (h === 12) return "12 PM"
  return `${h - 12} PM`
}
function fmtPrice(p: number | null) {
  return p ? "$" + p.toLocaleString() : "—"
}

// ── snapshot types ──────────────────────────────────────────────────────────

interface SnapListing {
  id:           number
  address:      string | null
  currentPrice: number | null
  status:       string
  community:    string
  builder:      string
}

// ── DB queries ──────────────────────────────────────────────────────────────

async function getCurrentSnapshot(): Promise<SnapListing[]> {
  const rows = await prisma.listing.findMany({
    where: {
      address: { not: null },
      NOT: [
        { address: { startsWith: "avail-" } },
        { address: { startsWith: "sold-"  } },
        { address: { startsWith: "future-"} },
      ],
    },
    select: {
      id: true, address: true, currentPrice: true, status: true,
      community: { select: { name: true, builder: { select: { name: true } } } },
    },
  })
  return rows.map(l => ({
    id:           l.id,
    address:      l.address,
    currentPrice: l.currentPrice,
    status:       l.status,
    community:    l.community.name,
    builder:      l.community.builder.name,
  }))
}

async function getPreviousSnapshot(date: string, hour: number): Promise<SnapListing[] | null> {
  const prevHour = hour === 0 ? 23 : hour - 1
  const prevDate = hour === 0
    ? new Date(Date.now() - PDT_OFFSET_MS - 86400000).toISOString().split("T")[0]
    : date

  const row = await prisma.hourlySnapshot.findFirst({
    where: { datePdt: prevDate, hourPdt: prevHour },
    orderBy: { capturedAt: "desc" },
  })
  return row ? (row.data as SnapListing[]) : null
}

async function getTodaySnapshots(date: string): Promise<{ hourPdt: number; data: SnapListing[] }[]> {
  const rows = await prisma.hourlySnapshot.findMany({
    where: { datePdt: date },
    orderBy: { hourPdt: "asc" },
  })
  return rows.map(r => ({ hourPdt: r.hourPdt, data: r.data as SnapListing[] }))
}

// ── diff ────────────────────────────────────────────────────────────────────

interface HourlyDiff {
  fromHour:     number
  toHour:       number
  newListings:  SnapListing[]
  soldListings: SnapListing[]
  priceChanges: { listing: SnapListing; oldPrice: number | null; newPrice: number | null }[]
}

function diffSnapshots(prev: SnapListing[], curr: SnapListing[]): Omit<HourlyDiff, "fromHour"|"toHour"> {
  const prevMap = new Map(prev.map(l => [l.id, l]))
  const currMap = new Map(curr.map(l => [l.id, l]))

  const newListings:  SnapListing[] = []
  const soldListings: SnapListing[] = []
  const priceChanges: HourlyDiff["priceChanges"] = []

  for (const [id, l] of currMap) {
    const p = prevMap.get(id)
    if (!p) {
      if (l.status === "active") newListings.push(l)
    } else if (p.currentPrice !== l.currentPrice) {
      priceChanges.push({ listing: l, oldPrice: p.currentPrice, newPrice: l.currentPrice })
    }
  }
  for (const [id, l] of prevMap) {
    const c = currMap.get(id)
    if ((!c || c.status === "sold") && l.status === "active") soldListings.push(l)
  }

  return { newListings, soldListings, priceChanges }
}

// ── performance check ───────────────────────────────────────────────────────

interface PerfResult { name: string; url: string; status: number; ms: number; ok: boolean; error?: string }

async function checkPerformance(): Promise<PerfResult[]> {
  const targets = [
    { name: "Homepage",       url: "https://newkey.us" },
    { name: "Listings API",   url: "https://newkey.us/api/listings" },
    { name: "Communities",    url: "https://newkey.us/communities" },
    { name: "Incentives",     url: "https://newkey.us/incentives" },
  ]
  return Promise.all(targets.map(async ({ name, url }) => {
    const t0 = Date.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      return { name, url, status: res.status, ms: Date.now() - t0, ok: res.ok }
    } catch (e) {
      return { name, url, status: 0, ms: Date.now() - t0, ok: false, error: String(e) }
    }
  }))
}

function perfSuggestions(results: PerfResult[]): string[] {
  const suggestions: string[] = []
  for (const r of results) {
    if (!r.ok)        suggestions.push(`🚨 ${r.name} returned ${r.status || "error"} — check deployment status`)
    else if (r.ms > 5000) suggestions.push(`🔴 ${r.name} is critically slow (${r.ms}ms) — investigate server logs`)
    else if (r.ms > 2000) suggestions.push(`🟡 ${r.name} is slow (${r.ms}ms) — consider caching or DB optimization`)
    else if (r.ms > 1000) suggestions.push(`⚪ ${r.name} response time could improve (${r.ms}ms)`)
  }
  if (suggestions.length === 0) suggestions.push("✅ All pages responding within normal range")
  return suggestions
}

// ── email HTML ──────────────────────────────────────────────────────────────

function buildDailyHtml(diffs: HourlyDiff[], perf: PerfResult[], date: string, snapshotCount: number) {
  const dateStr = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  })

  const totalNew   = diffs.reduce((s, d) => s + d.newListings.length,  0)
  const totalSold  = diffs.reduce((s, d) => s + d.soldListings.length, 0)
  const totalPrice = diffs.reduce((s, d) => s + d.priceChanges.length, 0)
  const suggestions = perfSuggestions(perf)

  let html = `
  <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">
    <div style="background:#1a1a1a;padding:20px 24px;border-radius:8px 8px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px">New Key — 24h Site Monitor</h1>
      <p style="margin:4px 0 0;color:#999;font-size:13px">${dateStr} · ${snapshotCount} snapshots · PDT</p>
    </div>
    <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e5e5;border-top:none">

      <!-- Summary bar -->
      <div style="display:flex;gap:10px;margin-bottom:24px">
        ${summaryBox("🆕 New",    totalNew,   "#16a34a")}
        ${summaryBox("🔴 Sold",   totalSold,  "#dc2626")}
        ${summaryBox("💰 Price Δ",totalPrice, "#d97706")}
        ${summaryBox("📸 Hours",  snapshotCount, "#2563eb")}
      </div>

      <!-- Performance -->
      <h2 style="font-size:15px;margin:0 0 10px;color:#1a1a1a">Site Performance</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <tr style="background:#e5e5e5">
          <th style="text-align:left;padding:6px 10px">Page</th>
          <th style="text-align:center;padding:6px 10px">Status</th>
          <th style="text-align:right;padding:6px 10px">Response</th>
        </tr>
        ${perf.map(r => `
        <tr style="border-top:1px solid #e5e5e5">
          <td style="padding:6px 10px">${r.name}</td>
          <td style="padding:6px 10px;text-align:center;color:${r.ok ? "#16a34a" : "#dc2626"}">${r.status || "err"}</td>
          <td style="padding:6px 10px;text-align:right;color:${r.ms > 2000 ? "#dc2626" : r.ms > 1000 ? "#d97706" : "#16a34a"}">${r.ms}ms</td>
        </tr>`).join("")}
      </table>

      <!-- Suggestions -->
      <h2 style="font-size:15px;margin:0 0 10px;color:#1a1a1a">Suggestions</h2>
      <ul style="margin:0 0 24px;padding-left:18px;font-size:13px;color:#444">
        ${suggestions.map(s => `<li style="margin-bottom:6px">${s}</li>`).join("")}
      </ul>

      <!-- Hourly changes -->
      <h2 style="font-size:15px;margin:0 0 12px;color:#1a1a1a">Hourly Changes</h2>
  `

  const activeDiffs = diffs.filter(d =>
    d.newListings.length || d.soldListings.length || d.priceChanges.length
  )

  if (activeDiffs.length === 0) {
    html += `<p style="color:#666;font-size:13px">No changes detected across any hour today.</p>`
  } else {
    for (const diff of activeDiffs) {
      html += `
      <div style="margin-bottom:16px;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:12px 14px">
        <div style="font-weight:700;font-size:13px;color:#1a1a1a;margin-bottom:8px">
          ${fmtTime(diff.fromHour)} → ${fmtTime(diff.toHour)}
          <span style="font-weight:400;color:#888;margin-left:8px">
            ${[
              diff.newListings.length  ? `+${diff.newListings.length} new`            : "",
              diff.soldListings.length ? `${diff.soldListings.length} sold`            : "",
              diff.priceChanges.length ? `${diff.priceChanges.length} price changes`   : "",
            ].filter(Boolean).join(" · ")}
          </span>
        </div>`

      if (diff.newListings.length) {
        html += `<div style="font-size:12px;color:#16a34a;font-weight:600;margin-bottom:4px">NEW LISTINGS</div>
        <ul style="margin:0 0 8px;padding-left:16px;font-size:12px">`
        for (const l of diff.newListings) {
          html += `<li><strong>${l.address}</strong> — ${l.community} (${l.builder}) · ${fmtPrice(l.currentPrice)}</li>`
        }
        html += `</ul>`
      }

      if (diff.soldListings.length) {
        html += `<div style="font-size:12px;color:#dc2626;font-weight:600;margin-bottom:4px">SOLD</div>
        <ul style="margin:0 0 8px;padding-left:16px;font-size:12px">`
        for (const l of diff.soldListings) {
          html += `<li><strong>${l.address}</strong> — ${l.community} (${l.builder}) · last price ${fmtPrice(l.currentPrice)}</li>`
        }
        html += `</ul>`
      }

      if (diff.priceChanges.length) {
        html += `<div style="font-size:12px;color:#d97706;font-weight:600;margin-bottom:4px">PRICE CHANGES</div>
        <ul style="margin:0 0 0;padding-left:16px;font-size:12px">`
        for (const pc of diff.priceChanges) {
          const dir = (pc.newPrice ?? 0) > (pc.oldPrice ?? 0) ? "↑" : "↓"
          html += `<li><strong>${pc.listing.address}</strong> — ${pc.listing.community} · ${fmtPrice(pc.oldPrice)} ${dir} ${fmtPrice(pc.newPrice)}</li>`
        }
        html += `</ul>`
      }

      html += `</div>`
    }
  }

  html += `
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0">
      <p style="font-size:12px;color:#999;margin:0">New Key · Hourly scraper · ${date} PDT</p>
    </div>
  </div>`

  return html
}

function summaryBox(label: string, value: number, color: string) {
  return `<div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:12px;text-align:center">
    <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">${label}</div>
    <div style="font-size:26px;font-weight:700;color:${color};margin:4px 0">${value}</div>
  </div>`
}

// ── main handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const hour = pdtHour()
  const date = pdtDate()

  // Only run 3 AM – midnight Pacific (hours 3–23 and 0)
  if (hour === 1 || hour === 2) {
    return NextResponse.json({ skipped: true, reason: `hour ${hour} PDT is outside window` })
  }

  try {
    const [current, previous] = await Promise.all([
      getCurrentSnapshot(),
      getPreviousSnapshot(date, hour),
    ])

    // Save current snapshot
    await prisma.hourlySnapshot.create({
      data: { hourPdt: hour, datePdt: date, data: current as object[] },
    })

    const diff = previous ? diffSnapshots(previous, current) : null

    // Midnight PDT (hour 0) = send daily report
    if (hour === 0) {
      const snapshotsToday = await getTodaySnapshots(date === pdtDate() ? date : pdtDate())
      const perf           = await checkPerformance()

      // Build diffs across all consecutive hourly pairs
      const diffs: HourlyDiff[] = []
      for (let i = 1; i < snapshotsToday.length; i++) {
        const prev = snapshotsToday[i - 1]
        const curr = snapshotsToday[i]
        const d    = diffSnapshots(prev.data, curr.data)
        diffs.push({ fromHour: prev.hourPdt, toHour: curr.hourPdt, ...d })
      }

      const html = buildDailyHtml(diffs, perf, date, snapshotsToday.length)

      const res = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body:    JSON.stringify({
          from:    FROM,
          to:      TO,
          subject: `New Key Site Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} (${snapshotsToday.length} snapshots, ${diffs.reduce((s,d) => s+d.newListings.length+d.soldListings.length+d.priceChanges.length, 0)} changes)`,
          html,
        }),
      })
      const emailData = await res.json()
      if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(emailData)}`)

      // Cleanup snapshots older than 48 hours
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
      await prisma.hourlySnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } })

      return NextResponse.json({
        ok: true, hour, date, snapshotsSaved: snapshotsToday.length,
        emailId: emailData.id,
        changes: diffs.reduce((s,d) => ({
          new:   s.new   + d.newListings.length,
          sold:  s.sold  + d.soldListings.length,
          price: s.price + d.priceChanges.length,
        }), { new: 0, sold: 0, price: 0 }),
      })
    }

    return NextResponse.json({
      ok: true, hour, date,
      activeListings: current.length,
      changes: diff ? {
        new:   diff.newListings.length,
        sold:  diff.soldListings.length,
        price: diff.priceChanges.length,
      } : null,
    })
  } catch (err) {
    console.error("hourly-scrape error:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
