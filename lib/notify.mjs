/**
 * lib/notify.mjs
 * Shared WhatsApp notification helper via Twilio.
 * Used by all scrapers to report run summaries, errors, and changes.
 */

export async function sendWhatsApp(message) {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const to    = process.env.TWILIO_WHATSAPP_TO
  const from  = process.env.TWILIO_WHATSAPP_FROM

  if (!sid || !token || !to || !from) {
    console.warn("  [notify] Twilio credentials not set — skipping WhatsApp notification")
    return
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method:  "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: message }).toString(),
      }
    )
    const json = await res.json()
    if (json.error_code) {
      console.warn(`  [notify] WhatsApp send failed: ${json.message}`)
    } else {
      console.log(`  [notify] WhatsApp sent ✓`)
    }
  } catch (e) {
    console.warn(`  [notify] WhatsApp error: ${e.message}`)
  }
}

/**
 * Build a scraper summary message.
 * @param {string} scraperName  e.g. "Lennar", "Toll Brothers"
 * @param {Array}  results      Array of { community, changes, error? }
 * @param {number} elapsedSec
 */
export function buildSummary(scraperName, results, elapsedSec) {
  const date    = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  const ok      = results.filter(r => !r.error)
  const failed  = results.filter(r => r.error)
  const changes = ok.reduce((s, r) => s + (r.changes || 0), 0)

  const lines = [`🏠 *New Key — ${scraperName} Scraper*`, `📅 ${date}`,""]

  if (changes > 0) {
    lines.push(`✅ ${changes} change(s) across ${ok.length} communities:`)
    for (const r of ok.filter(r => r.changes > 0)) {
      const parts = []
      if (r.newCount)   parts.push(`+${r.newCount} new`)
      if (r.soldCount)  parts.push(`${r.soldCount} sold`)
      if (r.priceCount) parts.push(`${r.priceCount} price change(s)`)
      lines.push(`  • ${r.community}: ${parts.join(", ") || r.changes + " change(s)"}`)
      if (r.newAddresses?.length)  r.newAddresses.forEach(a => lines.push(`      ↳ new: ${a}`))
      if (r.soldAddresses?.length) r.soldAddresses.forEach(a => lines.push(`      ↳ sold: ${a}`))
      if (r.priceDetails?.length)  r.priceDetails.forEach(p => lines.push(`      ↳ ${p.address}: $${Math.round(p.from/1000)}k → $${Math.round(p.to/1000)}k`))
    }
  } else {
    lines.push(`✅ No changes found across ${ok.length} communities`)
  }

  if (failed.length > 0) {
    lines.push("")
    lines.push(`⚠️ ${failed.length} community error(s):`)
    for (const r of failed) {
      lines.push(`  • ${r.community}: ${r.error}`)
    }
  }

  lines.push("", `⏱ ${elapsedSec}s`)
  return lines.join("\n")
}
