import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyAdminToken } from "@/lib/admin-auth"
import { getGoogleAnalyticsTraffic } from "@/lib/google-analytics"
import { getSupabaseAdmin } from "@/lib/supabase/service"

type AdminUserRow = {
  id: string
  email: string | null
  name: string | null
  source: "account" | "newsletter"
  joinedAt: string
  lastSignInAt: string | null
  emailConfirmedAt: string | null
  provider: string | null
  favorites: number
  follows: number
  rawInfo: Record<string, unknown>
}

function dateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value
  return date.toISOString().slice(0, 10)
}

function addToDaily(map: Map<string, { date: string; accounts: number; newsletters: number }>, date: string, field: "accounts" | "newsletters") {
  if (!map.has(date)) map.set(date, { date, accounts: 0, newsletters: 0 })
  map.get(date)![field]++
}

async function listSupabaseUsers(): Promise<AdminUserRow[]> {
  const rows: AdminUserRow[] = []
  let page = 1
  const perPage = 1000

  for (;;) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const users = data.users ?? []
    for (const user of users) {
      const metadata = user.user_metadata ?? {}
      const appMetadata = user.app_metadata ?? {}
      const provider = typeof appMetadata.provider === "string"
        ? appMetadata.provider
        : Array.isArray(appMetadata.providers)
        ? String(appMetadata.providers[0] ?? "")
        : null

      const fullName = [metadata.full_name, metadata.name]
        .map((value) => typeof value === "string" ? value.trim() : "")
        .find(Boolean) ?? null

      rows.push({
        id: user.id,
        email: user.email ?? null,
        name: fullName,
        source: "account",
        joinedAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        provider,
        favorites: 0,
        follows: 0,
        rawInfo: {
          phone: user.phone ?? null,
          role: user.role ?? null,
          appMetadata,
          userMetadata: metadata,
        },
      })
    }

    if (users.length < perPage) break
    page++
  }

  return rows
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminToken(req)
  if (authError) return authError

  try {
    const [accountUsers, newsletterSubscribers, favoriteCounts, followCounts, traffic] = await Promise.all([
      listSupabaseUsers(),
      prisma.newsletterSubscriber.findMany({
        orderBy: { subscribedAt: "desc" },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          subscribedAt: true,
          unsubscribed: true,
          unsubscribedAt: true,
        },
      }),
      prisma.userFavorite.groupBy({ by: ["userId"], _count: { userId: true } }),
      prisma.communityFollow.groupBy({ by: ["userId"], _count: { userId: true } }),
      getGoogleAnalyticsTraffic(30),
    ])

    const favoritesByUser = new Map(favoriteCounts.map((row) => [row.userId, row._count.userId]))
    const followsByUser = new Map(followCounts.map((row) => [row.userId, row._count.userId]))
    const accountEmails = new Set(accountUsers.map((user) => user.email?.toLowerCase()).filter(Boolean))

    const users: AdminUserRow[] = accountUsers.map((user) => ({
      ...user,
      favorites: favoritesByUser.get(user.id) ?? 0,
      follows: followsByUser.get(user.id) ?? 0,
    }))

    for (const subscriber of newsletterSubscribers) {
      if (accountEmails.has(subscriber.email.toLowerCase())) continue

      users.push({
        id: `newsletter-${subscriber.id}`,
        email: subscriber.email,
        name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" ") || null,
        source: "newsletter",
        joinedAt: subscriber.subscribedAt.toISOString(),
        lastSignInAt: null,
        emailConfirmedAt: null,
        provider: "newsletter",
        favorites: 0,
        follows: 0,
        rawInfo: {
          firstName: subscriber.firstName,
          lastName: subscriber.lastName,
          unsubscribed: subscriber.unsubscribed,
          unsubscribedAt: subscriber.unsubscribedAt?.toISOString() ?? null,
        },
      })
    }

    users.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())

    const daily = new Map<string, { date: string; accounts: number; newsletters: number }>()
    for (const user of accountUsers) addToDaily(daily, dateKey(user.joinedAt), "accounts")
    for (const sub of newsletterSubscribers) addToDaily(daily, dateKey(sub.subscribedAt), "newsletters")

    return NextResponse.json({
      users,
      signupChart: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      traffic,
      summary: {
        accounts: accountUsers.length,
        newsletterSubscribers: newsletterSubscribers.length,
        newsletterOnly: users.filter((user) => user.source === "newsletter").length,
        totalPeople: users.length,
      },
    })
  } catch (err) {
    console.error("[/api/admin/users] Unhandled error:", err)
    return NextResponse.json({ error: "Failed to load admin users." }, { status: 500 })
  }
}
