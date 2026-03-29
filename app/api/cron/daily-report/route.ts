import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

const RESEND_API_KEY = "re_26TAjmba_PgWVcabL98Hn5fBKa7Hn9HxM"
const FROM           = "New Key <reports@newkey.us>"
const TO             = "armin.sabe@gmail.com"

function formatPrice(p: number | null) {
  return p ? "$" + p.toLocaleString() : "N/A"
}

function buildHtml(data: {
  newListings:    Awaited<ReturnType<typeof getChanges>>["newListings"]
  newlySold:      Awaited<ReturnType<typeof getChanges>>["newlySold"]
  priceChanges:   Awaited<ReturnType<typeof getChanges>>["priceChanges"]
  todayTotal:     number
  yesterdayTotal: number
  since:          Date
  count11pm:      number | null
  count2am:       number | null
}) {
  const { newListings, newlySold, priceChanges, todayTotal, yesterdayTotal, since, count11pm, count2am } = data
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
        <div style="display:flex;gap:12px;margin-bottom:20px">
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

const PDT_OFFSET_MS = 7 * 60 * 60 * 1000 // UTC-7

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

async function getSnapshotCount(datePdt: string, hourPdt: number): Promise<number | null> {
  const row = await prisma.hourlySnapshot.findFirst({
    where: { datePdt, hourPdt },
    orderBy: { capturedAt: "desc" },
  })
  if (!row) return null
  const data = row.data as { status: string }[]
  return data.filter(l => l.status === "active").length
}

async function getChanges() {
  const since = getMidnightPacific() // midnight Pacific = start of today

  // Actual count before midnight = yesterday's snapshot
  const yesterdayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null }, firstDetected: { lt: since } },
  })

  // Count now = after 1 AM scrape
  const todayTotal = await prisma.listing.count({
    where: { status: "active", address: { not: null } },
  })

  // 11 PM snapshot (yesterday, hour 23) and 2 AM snapshot (today, hour 2)
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

export async function GET(req: Request) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    const changes = await getChanges()
    const html = buildHtml(changes)

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

    return NextResponse.json({ ok: true, id: data.id, changes: {
      newListings:  changes.newListings.length,
      newlySold:    changes.newlySold.length,
      priceChanges: changes.priceChanges.length,
    }})
  } catch (err) {
    console.error("Daily report error:", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
