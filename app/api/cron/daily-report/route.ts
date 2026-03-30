import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = "New Key <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"
const PDT_OFFSET_MS  = 7 * 60 * 60 * 1000 // UTC-7

const SHEET_ID = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
const BUILDER_GIDS: Record<string, string> = {
  "Toll Brothers":   "0",
  "Lennar":          "1235396983",
  "Pulte":           "1042095208",
  "Del Webb":        "847960742",
  "KB Home":         "2063280901",
  "Taylor Morrison": "1100202556",
  "Melia Homes":     "1767278823",
}

// ── helpers ─────────────────────────────────────────────────────────────────

function formatPrice(p: number | null) {
  return p ? "$" + p.toLocaleString() : "N/A"
}

function getMidnightPacific(): Date {
  const nowPacific = new Date(Date.now() - PDT_OFFSET_MS)
  const midnight = new Date(Date.UTC(
    nowPacific.getUTCFullYear(),
    nowPacific.getUTCMonth(),
    nowPacific.getUTCDate()
  ))
  return new Date(midnight.getTime() + PDT_OFFSET_MS)
}

function pdtDateStr(offsetDays = 0): string {
  return new Date(Date.now() - PDT_OFFSET_MS + offsetDays * 86400000).toISOString().split("T")[0]
}

// ── Table 2 check ────────────────────────────────────────────────────────────

interface T2Row { community: string; sold: number; forSale: number; future: number; total: number }
interface T2Mismatch {
  community: string
  builder: string
  sheet: T2Row
  db: T2Row
  diffs: string[]
}

async function fetchTable2(gid: string): Promise<T2Row[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  const res  = await fetch(url)
  const text = await res.text()
  const rows = text.split("\n").map(l => l.split(",").map(c => c.replace(/^"|"$/g, "").trim()))

  const results: T2Row[] = []
  let inTable2 = false
  for (const row of rows) {
    if (row[0] === "Community" && row[3] === "Community") { inTable2 = true; continue }
    if (!inTable2) continue
    if (!row[3]) break
    results.push({
      community: row[3],
      sold:   parseInt(row[4]) || 0,
      forSale: parseInt(row[5]) || 0,
      future: parseInt(row[6]) || 0,
      total:  parseInt(row[7]) || 0,
    })
  }
  return results
}

async function checkTable2Accuracy(): Promise<{ mismatches: T2Mismatch[]; allOk: boolean }> {
  const PLACEHOLDER_RE = /^(sold|avail|future)-\d+$/

  // Get all communities with their placeholder lots
  const communities = await prisma.community.findMany({
    include: {
      builder: { select: { name: true } },
      listings: { select: { status: true, lotNumber: true } },
    },
  })

  const dbMap = new Map<string, T2Row & { builder: string }>()
  for (const c of communities) {
    const ph  = c.listings.filter(l => l.lotNumber && PLACEHOLDER_RE.test(l.lotNumber))
    const src = ph.length > 0 ? ph : c.listings
    dbMap.set(c.name, {
      community: c.name,
      builder:   c.builder.name,
      sold:      src.filter(l => l.status === "sold").length,
      forSale:   src.filter(l => l.status === "active").length,
      future:    src.filter(l => l.status === "future").length,
      total:     src.filter(l => l.status !== "removed").length,
    })
  }

  const mismatches: T2Mismatch[] = []

  for (const [builderName, gid] of Object.entries(BUILDER_GIDS)) {
    let sheetRows: T2Row[]
    try { sheetRows = await fetchTable2(gid) } catch { continue }

    for (const sheet of sheetRows) {
      const db = dbMap.get(sheet.community)
      if (!db) continue

      const diffs: string[] = []
      if (sheet.sold    !== db.sold)   diffs.push(`Sold: sheet=${sheet.sold} db=${db.sold}`)
      if (sheet.forSale !== db.forSale) diffs.push(`For Sale: sheet=${sheet.forSale} db=${db.forSale}`)
      if (sheet.future  !== db.future) diffs.push(`Future: sheet=${sheet.future} db=${db.future}`)
      if (sheet.total   !== db.total)  diffs.push(`Total: sheet=${sheet.total} db=${db.total}`)

      if (diffs.length > 0) {
        mismatches.push({ community: sheet.community, builder: builderName, sheet, db, diffs })
      }
    }
  }

  return { mismatches, allOk: mismatches.length === 0 }
}

// ── snapshot helpers ─────────────────────────────────────────────────────────

async function getSnapshotCount(datePdt: string, hourPdt: number): Promise<number | null> {
  const row = await prisma.hourlySnapshot.findFirst({
    where: { datePdt, hourPdt },
    orderBy: { capturedAt: "desc" },
  })
  if (!row) return null
  const data = row.data as { status: string }[]
  return data.filter(l => l.status === "active").length
}

// ── DB changes ───────────────────────────────────────────────────────────────

async function getChanges() {
  const since = getMidnightPacific()

  const yesterdayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null }, firstDetected: { lt: since } },
  })
  const todayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null } },
  })
  const count11pm = await getSnapshotCount(pdtDateStr(-1), 23)
  const count2am  = await getSnapshotCount(pdtDateStr(0),  2)

  const newListings = await prisma.listing.findMany({
    where: { firstDetected: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: true } } },
    orderBy: { firstDetected: "desc" },
  })
  const newlySold = await prisma.listing.findMany({
    where: { soldAt: { gte: since }, address: { not: null } },
    include: { community: { include: { builder: true } } },
    orderBy: { soldAt: "desc" },
  })
  const priceChanges = await prisma.priceHistory.findMany({
    where: { detectedAt: { gte: since } },
    include: { listing: { include: { community: { include: { builder: true } } } } },
    orderBy: { detectedAt: "desc" },
  })

  return { newListings, newlySold, priceChanges, since, todayTotal, yesterdayTotal, count11pm, count2am }
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function buildHtml(data: {
  newListings:    Awaited<ReturnType<typeof getChanges>>["newListings"]
  newlySold:      Awaited<ReturnType<typeof getChanges>>["newlySold"]
  priceChanges:   Awaited<ReturnType<typeof getChanges>>["priceChanges"]
  todayTotal:     number
  yesterdayTotal: number
  since:          Date
  count11pm:      number | null
  count2am:       number | null
  t2Check:        Awaited<ReturnType<typeof checkTable2Accuracy>>
}) {
  const { newListings, newlySold, priceChanges, todayTotal, yesterdayTotal, since, count11pm, count2am, t2Check } = data
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

        <div style="display:flex;gap:12px;margin-bottom:24px">
          <div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center">
            <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">11 PM (pre-scrape)</div>
            <div style="font-size:28px;font-weight:700;color:#222;margin:4px 0">${count11pm ?? "—"}</div>
            <div style="font-size:11px;color:#999">for sale listings</div>
          </div>
          <div style="flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;text-align:center">
            <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:.5px">2 AM (post-scrape)</div>
            <div style="font-size:28px;font-weight:700;color:#222;margin:4px 0">${count2am ?? "—"}</div>
            <div style="font-size:11px;color:#999">for sale listings</div>
          </div>
        </div>
  `

  // ── Table 2 accuracy section ──
  body += `<h2 style="font-size:15px;color:#1a1a1a;margin:0 0 10px">📊 Community Card Accuracy (vs Google Sheet Table 2)</h2>`
  if (t2Check.allOk) {
    body += `<p style="color:#16a34a;margin:0 0 20px">✅ All community cards match Table 2 exactly.</p>`
  } else {
    body += `<p style="color:#dc2626;font-size:13px;margin:0 0 8px">⚠️ ${t2Check.mismatches.length} communit${t2Check.mismatches.length === 1 ? "y" : "ies"} out of sync with Table 2:</p>`
    body += `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">`
    body += `<tr style="background:#e5e5e5;text-align:left">
      <th style="padding:6px 8px">Community</th>
      <th style="padding:6px 8px">Field</th>
      <th style="padding:6px 8px;text-align:center">Sheet</th>
      <th style="padding:6px 8px;text-align:center">DB</th>
    </tr>`
    for (const m of t2Check.mismatches) {
      for (const diff of m.diffs) {
        const parts = diff.match(/^(.+): sheet=(\d+) db=(\d+)$/)
        if (!parts) continue
        body += `<tr style="border-top:1px solid #e5e5e5">
          <td style="padding:6px 8px">${m.community}</td>
          <td style="padding:6px 8px">${parts[1]}</td>
          <td style="padding:6px 8px;text-align:center">${parts[2]}</td>
          <td style="padding:6px 8px;text-align:center;color:#dc2626;font-weight:700">${parts[3]}</td>
        </tr>`
      }
    }
    body += `</table>`
  }

  // ── listing changes ──
  if (!hasChanges) {
    body += `<p style="color:#666;margin:0">✓ No changes detected in the last 24 hours.</p>`
  } else {
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

// ── main handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    const [changes, t2Check] = await Promise.all([getChanges(), checkTable2Accuracy()])
    const html = buildHtml({ ...changes, t2Check })

    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        from:    FROM,
        to:      TO,
        subject: `New Key Daily Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
        html,
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`)

    return NextResponse.json({ ok: true, id: data.id, t2Mismatches: t2Check.mismatches.length, changes: {
      newListings:  changes.newListings.length,
      newlySold:    changes.newlySold.length,
      priceChanges: changes.priceChanges.length,
    }})
  } catch (err) {
    console.error("Daily report error:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
