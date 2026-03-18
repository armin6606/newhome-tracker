const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://newkey.us"

function fmt(n: number | null | undefined) {
  if (!n) return "N/A"
  return "$" + n.toLocaleString()
}

// ─── Price Change Email ──────────────────────────────────────────────────────

export interface PriceChangeData {
  address: string
  community: string
  listingId: number
  oldPrice: number
  newPrice: number
  changeType: "increase" | "decrease"
  sqft?: number | null
  beds?: number | null
  baths?: number | null
  sourceUrl?: string | null
}

export function priceChangeSubject(data: PriceChangeData): string {
  const diff = Math.abs(data.newPrice - data.oldPrice)
  const direction = data.changeType === "decrease" ? "↓" : "↑"
  return `${direction} Price change: ${data.address} — ${fmt(data.newPrice)}`
}

export function priceChangeHtml(data: PriceChangeData): string {
  const diff = data.newPrice - data.oldPrice
  const absDiff = Math.abs(diff)
  const isDown = diff < 0
  const color = isDown ? "#16a34a" : "#dc2626"
  const arrow = isDown ? "↓" : "↑"

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 24px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
    <div style="background: #1e3a5f; padding: 20px 24px;">
      <a href="${SITE_URL}" style="text-decoration: none; color: white; font-size: 18px; font-weight: 700;">NewKey.us</a>
    </div>
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 4px; font-size: 18px; color: #111827;">Price ${isDown ? "Drop" : "Increase"} on a Saved Home</h2>
      <p style="margin: 0 0 20px; color: #6b7280; font-size: 14px;">${data.community}</p>

      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 8px;">${data.address}</div>
        ${data.beds ? `<div style="color: #6b7280; font-size: 13px;">${data.beds} bd · ${data.baths ?? "?"} ba${data.sqft ? ` · ${data.sqft.toLocaleString()} sqft` : ""}</div>` : ""}
      </div>

      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
        <div>
          <div style="font-size: 12px; color: #9ca3af; margin-bottom: 2px;">Was</div>
          <div style="font-size: 18px; font-weight: 600; color: #9ca3af; text-decoration: line-through;">${fmt(data.oldPrice)}</div>
        </div>
        <div style="font-size: 24px; color: ${color};">${arrow}</div>
        <div>
          <div style="font-size: 12px; color: #9ca3af; margin-bottom: 2px;">Now</div>
          <div style="font-size: 24px; font-weight: 700; color: ${color};">${fmt(data.newPrice)}</div>
        </div>
        <div style="margin-left: auto; text-align: right;">
          <div style="font-size: 12px; color: #9ca3af; margin-bottom: 2px;">Change</div>
          <div style="font-size: 16px; font-weight: 600; color: ${color};">${isDown ? "-" : "+"}${fmt(absDiff)}</div>
        </div>
      </div>

      <a href="${SITE_URL}/listings/${data.listingId}" style="display: block; background: #2563eb; color: white; text-align: center; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-bottom: 12px;">View Listing</a>
      ${data.sourceUrl ? `<a href="${data.sourceUrl}" style="display: block; border: 1px solid #e5e7eb; color: #374151; text-align: center; padding: 12px; border-radius: 8px; text-decoration: none; font-size: 14px;">View on Builder Site ↗</a>` : ""}
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #f3f4f6; text-align: center;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        You're receiving this because you saved this home on <a href="${SITE_URL}" style="color: #6b7280;">NewKey.us</a>.
        <a href="${SITE_URL}/dashboard" style="color: #6b7280; margin-left: 4px;">Manage preferences →</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

// ─── New Listing in Followed Community Email ─────────────────────────────────

export interface NewListingData {
  communityName: string
  communityId: number
  listings: {
    id: number
    address: string
    currentPrice: number | null
    beds: number | null
    baths: number | null
    sqft: number | null
    floorPlan: string | null
  }[]
}

export function newListingSubject(data: NewListingData): string {
  const count = data.listings.length
  return `${count} new home${count > 1 ? "s" : ""} in ${data.communityName}`
}

export function newListingHtml(data: NewListingData): string {
  const listingRows = data.listings
    .map(
      (l) => `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-bottom: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-weight: 600; color: #111827; font-size: 15px;">${l.address}</div>
          ${l.floorPlan ? `<div style="color: #6b7280; font-size: 13px; margin-top: 2px;">${l.floorPlan}</div>` : ""}
          <div style="color: #6b7280; font-size: 13px; margin-top: 4px;">${[l.beds && `${l.beds} bd`, l.baths && `${l.baths} ba`, l.sqft && `${l.sqft.toLocaleString()} sqft`].filter(Boolean).join(" · ")}</div>
        </div>
        <div style="font-size: 18px; font-weight: 700; color: #111827;">${fmt(l.currentPrice)}</div>
      </div>
      <a href="${SITE_URL}/listings/${l.id}" style="display: inline-block; margin-top: 10px; font-size: 13px; color: #2563eb; text-decoration: none; font-weight: 500;">View details →</a>
    </div>`
    )
    .join("")

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 24px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
    <div style="background: #1e3a5f; padding: 20px 24px;">
      <a href="${SITE_URL}" style="text-decoration: none; color: white; font-size: 18px; font-weight: 700;">NewKey.us</a>
    </div>
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 4px; font-size: 18px; color: #111827;">
        ${data.listings.length} New Home${data.listings.length > 1 ? "s" : ""} Available
      </h2>
      <p style="margin: 0 0 20px; color: #6b7280; font-size: 14px;">${data.communityName}</p>

      ${listingRows}

      <a href="${SITE_URL}/communities" style="display: block; background: #2563eb; color: white; text-align: center; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 16px;">View All Communities</a>
    </div>
    <div style="padding: 16px 24px; border-top: 1px solid #f3f4f6; text-align: center;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        You're receiving this because you follow ${data.communityName} on <a href="${SITE_URL}" style="color: #6b7280;">NewKey.us</a>.
        <a href="${SITE_URL}/dashboard" style="color: #6b7280; margin-left: 4px;">Manage preferences →</a>
      </p>
    </div>
  </div>
</body>
</html>`
}
