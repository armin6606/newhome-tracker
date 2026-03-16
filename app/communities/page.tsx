"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { formatPrice } from "@/lib/utils"

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

  useEffect(() => {
    fetch("/api/communities")
      .then((r) => r.json())
      .then((data) => { setCommunities(data); setLoading(false) })
  }, [])

  const maxSales = Math.max(...communities.map((c) => c.salesPerMonth), 1)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Communities</h1>
        <p className="text-gray-500 text-sm mt-1">Sales velocity and inventory by community</p>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-20">Loading...</div>
      ) : communities.length === 0 ? (
        <div className="text-center text-gray-400 py-20">No communities yet. Run the scraper first.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {communities.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-gray-900 text-base">{c.name}</h2>
                <a href={c.url} target="_blank" rel="noopener noreferrer"
                  className="text-blue-500 text-xs hover:underline shrink-0 ml-2">
                  View →
                </a>
              </div>
              <p className="text-xs text-gray-400 mb-4">{c.builderName} · {c.city}, {c.state}</p>

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
