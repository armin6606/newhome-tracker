"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, RefreshCw, Users } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type AdminUser = {
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

type SignupPoint = {
  date: string
  accounts: number
  newsletters: number
}

type TrafficPoint = {
  date: string
  activeUsers: number
  sessions: number
  pageViews: number
}

type ApiResponse = {
  users: AdminUser[]
  signupChart: SignupPoint[]
  traffic: {
    configured: boolean
    error: string | null
    rows: TrafficPoint[]
  }
  summary: {
    accounts: number
    newsletterSubscribers: number
    newsletterOnly: number
    totalPeople: number
  }
}

function formatDateTime(value: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  })
}

function formatTooltipLabel(value: unknown) {
  return typeof value === "string" ? formatDateLabel(value) : String(value ?? "")
}

function infoPreview(info: Record<string, unknown>) {
  const flat = Object.entries(info)
    .filter(([, value]) => value !== null && value !== "" && value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
  return flat.length ? flat.join(" | ") : "-"
}

export default function AdminUsersPage() {
  const [token, setToken] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("newkey-admin-token") ?? ""
  )
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [search, setSearch] = useState("")
  const initialTokenRef = useRef(token)

  const loadData = useCallback(async (tokenValue: string) => {
    const activeToken = tokenValue.trim()
    if (!activeToken) {
      setMessage("Enter the admin token first.")
      return
    }

    localStorage.setItem("newkey-admin-token", activeToken)
    setLoading(true)
    setMessage("")

    const res = await fetch("/api/admin/users", {
      headers: { "x-admin-token": activeToken },
    })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("newkey-admin-token")
        setToken("")
      }
      setMessage(json.error ?? "Could not load admin user data.")
      return
    }

    setData(json)
  }, [])

  useEffect(() => {
    if (initialTokenRef.current) void loadData(initialTokenRef.current)
  }, [loadData])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const users = data?.users ?? []
    if (!q) return users
    return users.filter((user) =>
      [
        user.email,
        user.name,
        user.source,
        user.provider,
        infoPreview(user.rawInfo),
      ].some((value) => value?.toLowerCase().includes(q))
    )
  }, [data, search])

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">User Admin</h1>
          <p className="mt-1 text-sm text-stone-500">
            Accounts, newsletter signups, engagement, and Google Analytics traffic.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Admin token"
            type="password"
            className="h-10 w-56 rounded-md border border-stone-300 px-3 text-sm"
          />
          <button
            onClick={() => loadData(token)}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RefreshCw size={16} />
            Load
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      )}

      {data && (
        <div className="space-y-5">
          <section className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-500">
                <Users size={16} />
                Total People
              </div>
              <div className="mt-2 text-3xl font-bold text-stone-900">{data.summary.totalPeople}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-sm font-semibold text-stone-500">Accounts</div>
              <div className="mt-2 text-3xl font-bold text-stone-900">{data.summary.accounts}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-sm font-semibold text-stone-500">Newsletter</div>
              <div className="mt-2 text-3xl font-bold text-stone-900">{data.summary.newsletterSubscribers}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="text-sm font-semibold text-stone-500">Newsletter Only</div>
              <div className="mt-2 text-3xl font-bold text-stone-900">{data.summary.newsletterOnly}</div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-bold text-stone-900">Signup Trend</h2>
                <span className="text-xs text-stone-500">All captured signups</span>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.signupChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip labelFormatter={formatTooltipLabel} />
                    <Legend />
                    <Bar dataKey="accounts" name="Accounts" stackId="a" fill="#2563eb" />
                    <Bar dataKey="newsletters" name="Newsletter" stackId="a" fill="#16a34a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 font-bold text-stone-900">
                  <Activity size={17} />
                  Site Traffic
                </h2>
                <span className="text-xs text-stone-500">Google Analytics, last 30 days</span>
              </div>
              {data.traffic.rows.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.traffic.rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                      <XAxis dataKey="date" tickFormatter={formatDateLabel} tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip labelFormatter={formatTooltipLabel} />
                      <Legend />
                      <Area type="monotone" dataKey="activeUsers" name="Active users" stroke="#7c3aed" fill="#ddd6fe" />
                      <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#0891b2" fill="#cffafe" />
                      <Area type="monotone" dataKey="pageViews" name="Page views" stroke="#ea580c" fill="#fed7aa" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-72 items-center justify-center rounded-md bg-stone-50 px-6 text-center text-sm text-stone-500">
                  {data.traffic.error ?? "No Google Analytics traffic rows returned."}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 p-4">
              <h2 className="font-bold text-stone-900">People</h2>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search people"
                className="ml-auto h-10 w-full rounded-md border border-stone-300 px-3 text-sm sm:w-72"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Person</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="px-4 py-3">Last sign in</th>
                    <th className="px-4 py-3">Confirmed</th>
                    <th className="px-4 py-3">Saved</th>
                    <th className="px-4 py-3">Follows</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-t border-stone-100 align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-stone-900">{user.email ?? "-"}</div>
                        <div className="text-xs text-stone-500">{user.name ?? user.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">
                          {user.source}
                        </span>
                        {user.provider && <div className="mt-1 text-xs text-stone-500">{user.provider}</div>}
                      </td>
                      <td className="px-4 py-3 text-stone-700">{formatDateTime(user.joinedAt)}</td>
                      <td className="px-4 py-3 text-stone-700">{formatDateTime(user.lastSignInAt)}</td>
                      <td className="px-4 py-3 text-stone-700">{formatDateTime(user.emailConfirmedAt)}</td>
                      <td className="px-4 py-3 text-stone-700">{user.favorites}</td>
                      <td className="px-4 py-3 text-stone-700">{user.follows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredUsers.length === 0 && (
              <div className="p-8 text-center text-sm text-stone-500">No matching people found.</div>
            )}
          </section>
        </div>
      )}

      {!data && !loading && !message && (
        <div className="rounded-lg border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">
          Enter the admin token to load user and traffic data.
        </div>
      )}
    </main>
  )
}
