"use client"

import { useEffect, useState } from "react"
import { ContentGate } from "@/app/_components/ContentGate"

interface UpcomingPlan {
  builder:   string
  community: string
  city:      string
  floorplan: string
  type:      string | null
  floors:    number | null
  sqft:      number | null
  beds:      number | null
  baths:     number | null
  readyBy:   string | null
  hoaFees:   number | null
  taxes:     string | null
  schools:   string[]
}

const COLUMNS = ["Community", "City", "Builder", "Type", "Plan", "Bed / Bath", "Floors", "Sqft", "HOA / mo", "Tax Rate", "Est. Opening"]

function fmt(n: number | null, prefix = "") {
  if (n == null) return "—"
  return prefix + n.toLocaleString()
}

export default function UpcomingPage() {
  const [plans, setPlans]     = useState<UpcomingPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/upcoming")
      .then(r => r.json())
      .then(d => {
        if (d.ok) setPlans(d.plans)
        else setError(d.error ?? "Failed to load")
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 160 }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1600&q=80')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Coming Soon</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Upcoming <span className="text-amber-300">Communities</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Future lots and floor plans not yet released — track what&apos;s coming before it hits the market.
          </p>
        </div>
      </div>

      <ContentGate>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {COLUMNS.map((col) => (
                  <th key={col} className="px-4 py-3 whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-16 text-center text-gray-400 text-sm">
                    Loading upcoming communities…
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-16 text-center text-red-500 text-sm">
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && plans.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                        <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                        </svg>
                      </div>
                      <p className="text-gray-500 font-medium">No upcoming communities yet</p>
                      <p className="text-gray-400 text-xs max-w-xs">
                        Add entries to Table 4 in a builder&apos;s Google Sheet and they will appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && plans.map((p, i) => (
                <tr
                  key={i}
                  className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{p.community}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.city || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.builder}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.type || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.floorplan}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {p.beds != null && p.baths != null ? `${p.beds} / ${p.baths}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmt(p.floors)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(p.sqft)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(p.hoaFees, "$")}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.taxes ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {p.readyBy || <span className="text-gray-400">TBD</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && plans.length > 0 && (
          <p className="mt-3 text-xs text-gray-400 text-right">
            {plans.length} floor plan{plans.length !== 1 ? "s" : ""} across{" "}
            {new Set(plans.map(p => p.community)).size} upcoming communit{new Set(plans.map(p => p.community)).size !== 1 ? "ies" : "y"}
          </p>
        )}
      </ContentGate>
    </div>
  )
}
