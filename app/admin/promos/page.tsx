"use client"

import { useEffect, useState } from "react"
import { Check, RefreshCw, X } from "lucide-react"

type Promo = {
  id: number
  status: string
  sourceFrom: string | null
  sourceSubject: string | null
  sourceDate: string | null
  rawSnippet: string | null
  builderName: string | null
  communityName: string | null
  offerText: string
  offerUrl: string | null
  expiresAt: string | null
  confidence: number | null
  notes: string | null
  affectedListings: number
  createdAt: string
}

function dateValue(value: string | null) {
  return value ? value.slice(0, 10) : ""
}

export default function PromoApprovalsPage() {
  const [token, setToken] = useState("")
  const [status, setStatus] = useState("pending")
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const savedToken = localStorage.getItem("newkey-admin-token") ?? ""
    setToken(savedToken)
    if (savedToken) void loadPromos(status, savedToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPromos(nextStatus = status, tokenOverride = token) {
    const activeToken = tokenOverride.trim()
    if (!activeToken) {
      setHasLoaded(false)
      setPromos([])
      setMessage("Enter the admin approval token first.")
      return
    }
    localStorage.setItem("newkey-admin-token", activeToken)
    setLoading(true)
    setMessage("")
    const res = await fetch(`/api/admin/promos?status=${nextStatus}`, {
      headers: { "x-admin-token": activeToken },
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) {
      setHasLoaded(false)
      if (res.status === 401) {
        localStorage.removeItem("newkey-admin-token")
        setToken("")
        setPromos([])
        setMessage("Admin token is expired or incorrect. Paste the current CRON_SECRET, then click Load.")
        return
      }
      setMessage(json.error ?? "Could not load promos.")
      return
    }
    setHasLoaded(true)
    setPromos(json.promos ?? [])
  }

  function updatePromo(id: number, patch: Partial<Promo>) {
    setPromos((rows) => rows.map((promo) => promo.id === id ? { ...promo, ...patch } : promo))
  }

  async function submitAction(promo: Promo, action: "approve" | "reject" | "update") {
    setLoading(true)
    setMessage("")
    const res = await fetch(`/api/admin/promos/${promo.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify({
        action,
        builderName: promo.builderName,
        communityName: promo.communityName,
        offerText: promo.offerText,
        offerUrl: promo.offerUrl,
        expiresAt: promo.expiresAt,
        notes: promo.notes,
      }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) {
      setMessage(json.error ?? "Action failed.")
      return
    }
    setMessage(
      action === "approve"
        ? `Approved. Updated ${json.affectedListings ?? 0} active listings.`
        : action === "reject"
        ? "Rejected."
        : "Saved."
    )
    await loadPromos(status)
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Promo Approvals</h1>
          <p className="mt-1 text-sm text-stone-500">
            Review newsletter promos before they publish to active listings.
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
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              loadPromos(event.target.value)
            }}
            className="h-10 rounded-md border border-stone-300 px-3 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={() => loadPromos()}
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

      <div className="space-y-4">
        {promos.map((promo) => (
          <section key={promo.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-stone-500">
              <span className="rounded bg-stone-100 px-2 py-1 font-semibold text-stone-700">
                #{promo.id} {promo.status}
              </span>
              {promo.sourceFrom && <span>From: {promo.sourceFrom}</span>}
              {promo.sourceSubject && <span>Subject: {promo.sourceSubject}</span>}
              <span>Created: {new Date(promo.createdAt).toLocaleString()}</span>
              {promo.affectedListings > 0 && <span>{promo.affectedListings} listings updated</span>}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase text-stone-500">
                Builder
                <input
                  value={promo.builderName ?? ""}
                  onChange={(event) => updatePromo(promo.id, { builderName: event.target.value })}
                  className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3 text-sm font-normal normal-case text-stone-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-stone-500">
                Community
                <input
                  value={promo.communityName ?? ""}
                  onChange={(event) => updatePromo(promo.id, { communityName: event.target.value || null })}
                  placeholder="Leave blank for builder-wide"
                  className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3 text-sm font-normal normal-case text-stone-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-stone-500">
                Offer URL
                <input
                  value={promo.offerUrl ?? ""}
                  onChange={(event) => updatePromo(promo.id, { offerUrl: event.target.value || null })}
                  className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3 text-sm font-normal normal-case text-stone-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-stone-500">
                Expiration
                <input
                  value={dateValue(promo.expiresAt)}
                  onChange={(event) => updatePromo(promo.id, { expiresAt: event.target.value || null })}
                  type="date"
                  className="mt-1 block h-10 w-full rounded-md border border-stone-300 px-3 text-sm font-normal normal-case text-stone-900"
                />
              </label>
            </div>

            <label className="mt-3 block text-xs font-semibold uppercase text-stone-500">
              Offer Text
              <textarea
                value={promo.offerText}
                onChange={(event) => updatePromo(promo.id, { offerText: event.target.value })}
                rows={4}
                className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-normal normal-case text-stone-900"
              />
            </label>

            {promo.rawSnippet && (
              <p className="mt-3 rounded-md bg-stone-50 p-3 text-xs leading-relaxed text-stone-500">
                {promo.rawSnippet}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => submitAction(promo, "update")}
                disabled={loading}
                className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 disabled:opacity-60"
              >
                Save
              </button>
              <button
                onClick={() => submitAction(promo, "reject")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
              >
                <X size={16} />
                Reject
              </button>
              <button
                onClick={() => submitAction(promo, "approve")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <Check size={16} />
                Approve
              </button>
            </div>
          </section>
        ))}

        {!loading && promos.length === 0 && (
          <div className="rounded-lg border border-stone-200 bg-white p-10 text-center text-sm text-stone-500">
            {hasLoaded
              ? "No promos in this queue."
              : token
              ? "Click Load to fetch the approval queue."
              : "Enter the admin token to load the approval queue."}
          </div>
        )}
      </div>
    </main>
  )
}
