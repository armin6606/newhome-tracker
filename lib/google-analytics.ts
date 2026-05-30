import { createSign } from "crypto"

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const TOKEN_URL = "https://oauth2.googleapis.com/token"

let tokenCache: { token: string; expiresAt: number } | null = null

type GoogleServiceAccount = {
  client_email: string
  private_key: string
}

export type TrafficPoint = {
  date: string
  activeUsers: number
  sessions: number
  pageViews: number
}

function getPropertyId() {
  return process.env.GOOGLE_ANALYTICS_PROPERTY_ID || process.env.GA4_PROPERTY_ID || ""
}

function parseServiceAccount(): GoogleServiceAccount | null {
  const raw = process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<GoogleServiceAccount>
    if (!parsed.client_email || !parsed.private_key) return null
    return { client_email: parsed.client_email, private_key: parsed.private_key }
  } catch {
    return null
  }
}

async function getAccessToken(): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token

  const serviceAccount = parseServiceAccount()
  if (!serviceAccount) return null

  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: GA_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  })).toString("base64url")

  const signingInput = `${header}.${payload}`
  const sign = createSign("RSA-SHA256")
  sign.update(signingInput)
  const signature = sign.sign(serviceAccount.private_key.replace(/\\n/g, "\n"), "base64url")

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
  })

  if (!res.ok) return null

  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) return null

  tokenCache = {
    token: data.access_token,
    expiresAt: (now + (data.expires_in ?? 3600) - 60) * 1000,
  }
  return tokenCache.token
}

function formatGaDate(value: string) {
  if (value.length !== 8) return value
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export async function getGoogleAnalyticsTraffic(days = 30): Promise<{
  configured: boolean
  error: string | null
  rows: TrafficPoint[]
}> {
  const propertyId = getPropertyId()
  const token = await getAccessToken()

  if (!propertyId || !token) {
    return {
      configured: false,
      error: "Google Analytics Data API is not configured. Set GOOGLE_ANALYTICS_PROPERTY_ID and a service account JSON secret with Analytics Viewer access.",
      rows: [],
    }
  }

  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return { configured: true, error: `Google Analytics request failed (${res.status}): ${text}`, rows: [] }
  }

  const json = await res.json() as {
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>
      metricValues?: Array<{ value?: string }>
    }>
  }

  return {
    configured: true,
    error: null,
    rows: (json.rows ?? []).map((row) => ({
      date: formatGaDate(row.dimensionValues?.[0]?.value ?? ""),
      activeUsers: Number(row.metricValues?.[0]?.value ?? 0),
      sessions: Number(row.metricValues?.[1]?.value ?? 0),
      pageViews: Number(row.metricValues?.[2]?.value ?? 0),
    })),
  }
}
