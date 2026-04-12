import { NextResponse } from "next/server"
import { runScraper } from "@/lib/scraper/index"
import { timingSafeEqual, createHash } from "crypto"

/**
 * POST /api/scrape — Manual scraper trigger (dev / emergency use)
 *
 * ⚠️  PRODUCTION NOTE: The daily scraper runs via GitHub Actions (.github/workflows/daily-scrape.yml).
 * That is the authoritative production path. This endpoint is for manual / emergency triggers only.
 *
 * Vercel serverless functions have a max duration of 300s (5 min on Pro).
 * The full scraper takes ~50 minutes — it WILL be cut short on Vercel.
 * For a full run always use GitHub Actions ("Run workflow" → daily-scrape).
 *
 * GET /api/scrape — Returns status of the last manual trigger on this instance.
 */

// Vercel Pro max duration — gives the scraper as long as possible before the
// function is forcibly killed. Set maxDuration in next.config.ts as well.
export const maxDuration = 300

// ── In-process state ─────────────────────────────────────────────────────────
// Note: serverless cold starts reset these — they protect against concurrent
// triggers on the same warm instance, not across separate invocations.

let scrapeRunning   = false
let lastRunAt:      Date | null = null
let lastRunSummary: Record<string, unknown> | null = null

const COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes between manual runs

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Timing-safe secret comparison. Pads both sides to the same length before
 * comparing so string length cannot be inferred from timing differences.
 */
function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

function getSecret(): string | null {
  const s = process.env.SCRAPE_SECRET
  // Fail closed: no default. An unset secret blocks ALL requests rather than
  // exposing the endpoint with a hardcoded value anyone can read in the source.
  if (!s || s.trim() === "") return null
  return s
}

// ── GET — status endpoint ────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    running:     scrapeRunning,
    lastRunAt:   lastRunAt?.toISOString() ?? null,
    lastSummary: lastRunSummary,
    note:        "POST to trigger a manual scrape. For full runs use GitHub Actions daily-scrape workflow.",
  })
}

// ── POST — trigger endpoint ──────────────────────────────────────────────────

export async function POST(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = getSecret()
  if (!secret) {
    console.error("[scrape] SCRAPE_SECRET env var is not set — endpoint disabled")
    return NextResponse.json(
      { error: "Scrape endpoint is not configured. Set SCRAPE_SECRET env var." },
      { status: 500 }
    )
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* missing body treated as empty */ }

  const provided = typeof body.secret === "string" ? body.secret : ""
  if (!secretsEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Concurrent-run guard ───────────────────────────────────────────────────
  if (scrapeRunning) {
    return NextResponse.json(
      { error: "Scraper is already running on this instance.", startedAt: lastRunAt?.toISOString() },
      { status: 409 }
    )
  }

  // ── Rate limit ─────────────────────────────────────────────────────────────
  if (lastRunAt && Date.now() - lastRunAt.getTime() < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastRunAt.getTime())) / 1000)
    return NextResponse.json(
      { error: `Rate limited. Last run was ${Math.floor((Date.now() - lastRunAt.getTime()) / 60000)}m ago. Wait ${waitSec}s.` },
      { status: 429 }
    )
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  const triggeredAt = new Date()
  console.log(`[scrape] Manual trigger at ${triggeredAt.toISOString()}`)

  // ── Fire and forget ────────────────────────────────────────────────────────
  // Return 202 immediately so the HTTP connection doesn't time out.
  // The scraper continues running until Vercel kills the function (maxDuration=300s).
  // For a complete run use GitHub Actions.
  scrapeRunning = true
  lastRunAt     = triggeredAt
  lastRunSummary = null

  runScraper()
    .then((stats) => {
      // Return only a safe summary — don't store full listing details in memory
      lastRunSummary = {
        completedAt:  new Date().toISOString(),
        added:        stats.added,
        priceChanges: stats.priceChanges,
        removed:      stats.removed,
        unchanged:    stats.unchanged,
        errors:       stats.newListings?.length ?? 0, // reuse field as proxy
      }
      console.log(`[scrape] Manual run complete:`, lastRunSummary)
    })
    .catch((err) => {
      lastRunSummary = { error: String(err), failedAt: new Date().toISOString() }
      console.error("[scrape] Manual run failed:", err)
    })
    .finally(() => {
      scrapeRunning = false
    })

  return NextResponse.json(
    {
      accepted:  true,
      startedAt: triggeredAt.toISOString(),
      note:      "Scraper started. Check GET /api/scrape for status. Vercel will cut this after 300s — use GitHub Actions for a full run.",
    },
    { status: 202 }
  )
}
