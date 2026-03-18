"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { formatPrice } from "@/lib/utils"
import { FollowButton } from "@/app/_components/FollowButton"

type Community = {
  id: number
  name: string
  city: string
  state: string
  url: string
  builderName: string
  firstDetected: string
  totalReleased: number
  sold: number
  active: number
  salesPerMonth: number
  avgDaysOnMarket: number | null
  minPrice: number | null
  maxPrice: number | null
}

function PaceBar({ salesPerMonth, max }: { salesPerMonth: number; max: number }) {
  const pct = max > 0 ? Math.min((salesPerMonth / max) * 100, 100) : 0
  const color = pct > 66 ? "bg-green-500" : pct > 33 ? "bg-yellow-500" : "bg-red-400"
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [followIds, setFollowIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetch("/api/communities")
      .then((r) => r.json())
      .then((data) => { setCommunities(data); setLoading(false) })
  }, [])

  useEffect(() => {
    fetch("/api/follows")
      .then((r) => r.json())
      .then((ids: number[]) => { if (Array.isArray(ids)) setFollowIds(new Set(ids)) })
      .catch(() => {})
  }, [])

  const maxSales = Math.max(...communities.map((c) => c.salesPerMonth), 1)

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 160 }}>
        <div className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1600&q=80')" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Builder Communities</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Active <span className="text-amber-300">Communities</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Sales velocity, inventory levels, and pricing by new construction community.
          </p>
          {!loading && (
            <div className="mt-4 flex gap-6">
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{communities.length}</span>
                <span className="text-stone-400 text-xs mt-0.5">Communities</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">
                  {communities.reduce((s, c) => s + c.active, 0)}
                </span>
                <span className="text-stone-400 text-xs mt-0.5">Active Listings</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">
                  {communities.reduce((s, c) => s + c.sold, 0)}
                </span>
                <span className="text-stone-400 text-xs mt-0.5">Sold / Removed</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-20">Loading...</div>
      ) : communities.length === 0 ? (
        <div className="text-center text-gray-400 py-20">No communities yet. Run the scraper first.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {communities.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-1 gap-2">
                <h2 className="font-semibold text-gray-900 text-base leading-snug">{c.name}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <FollowButton communityId={c.id} initialFollowing={followIds.has(c.id)} />
                  <a href={c.url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 text-xs hover:underline">
                    View →
                  </a>
                </div>
              </div>
              <p className="text-xs mb-4">
                <span className={
                  c.builderName.toLowerCase().includes("lennar")
                    ? "font-semibold text-[#1B4FA8]"
                    : c.builderName.toLowerCase().includes("toll")
                    ? "font-semibold text-[#C9940A]"
                    : "text-gray-400"
                }>{c.builderName}</span>
                <span className="text-gray-400"> · {c.city}, {c.state}</span>
              </p>

              {/* Inventory bar */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="text-center bg-blue-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-blue-700">{c.totalReleased}</div>
                  <div className="text-xs text-gray-500">Released</div>
                </div>
                <div className="text-center bg-green-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-green-700">{c.active}</div>
                  <div className="text-xs text-gray-500">Available</div>
                </div>
                <div className="text-center bg-gray-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-gray-600">{c.sold}</div>
                  <div className="text-xs text-gray-500">Sold</div>
                </div>
              </div>

              {/* Sales pace */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Sales pace</span>
                  <span className="font-semibold text-gray-800">{c.salesPerMonth}/month</span>
                </div>
                <PaceBar salesPerMonth={c.salesPerMonth} max={maxSales} />
              </div>

              {/* Stats */}
              <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                <span>
                  {c.avgDaysOnMarket ? `Avg ${c.avgDaysOnMarket}d on market` : "No sales yet"}
                </span>
                {c.minPrice && c.maxPrice && (
                  <span>{formatPrice(c.minPrice)} – {formatPrice(c.maxPrice)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
        <strong>Sales pace color guide:</strong> Green = fast (&gt;66% of top community), Yellow = moderate, Red = slow
      </div>
    </div>
  )
}
