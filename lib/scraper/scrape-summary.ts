import { getResend, FROM_EMAIL } from "@/lib/email/resend"
import type { ChangeDetails } from "./detect-changes"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://newkey.us"
const SUMMARY_RECIPIENT = "info@newkey.us"

function fmt(n: number | null | undefined) {
  if (!n) return "N/A"
  return "$" + n.toLocaleString()
}

export interface ScrapeSummaryData {
  scrapeTime: Date
  totalScraped: number
  changes: ChangeDetails
  errors: { builder: string; error: string }[]
}

export function scrapeSummarySubject(data: ScrapeSummaryData): string {
  const date = data.scrapeTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `Scrape Summary ${date}: ${data.changes.added} new, ${data.changes.priceChanges} price changes, ${data.changes.removed} sold`
}

export function scrapeSummaryHtml(data: ScrapeSummaryData): string {
  const { changes, totalScraped, scrapeTime, errors } = data

  const dateStr = scrapeTime.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const timeStr = scrapeTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })

  // --- New Listings Section ---
  let newListingsSection = ""
  if (changes.newListings.length > 0) {
    const rows = changes.newListings
      .map(
        (l) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;">${l.address}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${l.community}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${l.builder}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827; font-weight: 600; text-align: right;">${fmt(l.price)}</td>
        </tr>`
      )
      .join("")

    newListingsSection = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #16a34a;">&#x2795; New Listings (${changes.newListings.length})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Address</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Community</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Builder</th>
              <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // --- Price Changes Section ---
  let priceChangesSection = ""
  if (changes.priceChangeDetails.length > 0) {
    const rows = changes.priceChangeDetails
      .map((l) => {
        const diff = l.newPrice - l.oldPrice
        const isDown = diff < 0
        const color = isDown ? "#16a34a" : "#dc2626"
        const arrow = isDown ? "&#x2193;" : "&#x2191;"
        return `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;">${l.address}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${l.community}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #9ca3af; text-decoration: line-through; text-align: right;">${fmt(l.oldPrice)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: ${color}; font-weight: 600; text-align: right;">${arrow} ${fmt(l.newPrice)}</td>
        </tr>`
      })
      .join("")

    priceChangesSection = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #2563eb;">&#x1F4B0; Price Changes (${changes.priceChangeDetails.length})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Address</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Community</th>
              <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">Old Price</th>
              <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">New Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // --- Sold/Removed Section ---
  let removedSection = ""
  if (changes.removedListings.length > 0) {
    const rows = changes.removedListings
      .map(
        (l) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;">${l.address}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${l.community}</td>
        </tr>`
      )
      .join("")

    removedSection = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #dc2626;">&#x1F3E0; Sold / Removed (${changes.removedListings.length})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Address</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Community</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // --- Incentives Section ---
  let incentivesSection = ""
  if (changes.newIncentives.length > 0) {
    const rows = changes.newIncentives
      .map(
        (l) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;">${l.address}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${l.community}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #7c3aed;">${l.incentives}</td>
        </tr>`
      )
      .join("")

    incentivesSection = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #7c3aed;">&#x1F381; New Incentives (${changes.newIncentives.length})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Address</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Community</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Incentive</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // --- Errors Section ---
  let errorsSection = ""
  if (errors.length > 0) {
    const rows = errors
      .map(
        (e) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827; font-weight: 600;">${e.builder}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #dc2626;">${e.error}</td>
        </tr>`
      )
      .join("")

    errorsSection = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #dc2626;">&#x26A0;&#xFE0F; Errors (${errors.length})</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #fef2f2;">
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Builder</th>
              <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // --- No Changes Message ---
  const hasChanges =
    changes.newListings.length > 0 ||
    changes.priceChangeDetails.length > 0 ||
    changes.removedListings.length > 0 ||
    changes.newIncentives.length > 0
  const noChangesMessage = !hasChanges
    ? `<p style="color: #6b7280; font-size: 14px; text-align: center; padding: 24px 0;">No changes detected in this scrape run.</p>`
    : ""

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
    <div style="background: #1e3a5f; padding: 20px 24px;">
      <a href="${SITE_URL}" style="text-decoration: none; color: white; font-size: 18px; font-weight: 700;">NewKey.us</a>
      <span style="color: #93c5fd; font-size: 14px; margin-left: 12px;">Daily Scrape Summary</span>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 4px; color: #6b7280; font-size: 13px;">${dateStr} at ${timeStr}</p>
      <h2 style="margin: 0 0 20px; font-size: 18px; color: #111827;">Scrape Results</h2>

      <!-- Stats Cards -->
      <div style="display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 100px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #16a34a;">${changes.added}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">New</div>
        </div>
        <div style="flex: 1; min-width: 100px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #2563eb;">${changes.priceChanges}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Price Changes</div>
        </div>
        <div style="flex: 1; min-width: 100px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #dc2626;">${changes.removed}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Sold/Removed</div>
        </div>
        <div style="flex: 1; min-width: 100px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #374151;">${totalScraped}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Total Scraped</div>
        </div>
      </div>

      ${noChangesMessage}
      ${newListingsSection}
      ${priceChangesSection}
      ${removedSection}
      ${incentivesSection}
      ${errorsSection}

      <a href="${SITE_URL}/communities" style="display: block; background: #2563eb; color: white; text-align: center; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 8px;">View All Communities</a>
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #f3f4f6; text-align: center;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        Automated scrape summary from <a href="${SITE_URL}" style="color: #6b7280;">NewKey.us</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export async function sendScrapeSummary(data: ScrapeSummaryData): Promise<void> {
  await getResend().emails.send({
    from: FROM_EMAIL,
    to: SUMMARY_RECIPIENT,
    subject: scrapeSummarySubject(data),
    html: scrapeSummaryHtml(data),
  })
}
