import { prisma } from "@/lib/db"

export type TrafficPoint = {
  date: string
  activeUsers: number
  sessions: number
  pageViews: number
}

let tableReady: Promise<void> | null = null

export function ensureSiteVisitsTable() {
  tableReady ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "site_visits" (
        "id" SERIAL PRIMARY KEY,
        "sessionId" TEXT,
        "path" TEXT NOT NULL,
        "referrer" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "site_visits_createdAt_idx" ON "site_visits" ("createdAt")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "site_visits_sessionId_idx" ON "site_visits" ("sessionId")`)
  })()

  return tableReady
}

export async function recordSiteVisit(data: {
  path: string
  referrer: string | null
  sessionId: string | null
  userAgent: string | null
}) {
  await ensureSiteVisitsTable()
  await prisma.siteVisit.create({ data })
}

export async function getFirstPartyTraffic(days = 30) {
  await ensureSiteVisitsTable()

  const rows = await prisma.$queryRaw<Array<{
    date: string
    activeUsers: bigint
    sessions: bigint
    pageViews: bigint
  }>>`
    SELECT
      to_char("createdAt" AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS date,
      COUNT(DISTINCT COALESCE("sessionId", "userAgent", id::text)) AS "activeUsers",
      COUNT(DISTINCT COALESCE("sessionId", id::text)) AS sessions,
      COUNT(*) AS "pageViews"
    FROM "site_visits"
    WHERE "createdAt" >= NOW() - (${days}::text || ' days')::interval
    GROUP BY 1
    ORDER BY 1 ASC
  `

  return {
    configured: true,
    error: rows.length === 0 ? "Traffic tracking is active. Visits will appear here after people load the site." : null,
    rows: rows.map((row) => ({
      date: row.date,
      activeUsers: Number(row.activeUsers),
      sessions: Number(row.sessions),
      pageViews: Number(row.pageViews),
    })),
  }
}
