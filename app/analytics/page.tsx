"use client"

import { useEffect, useState } from "react"
import { formatPrice } from "@/lib/utils"
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts"

type AnalyticsData = {
  soldByMonth: { month: string; count: number }[]
  activeByMonth: { month: string; count: number }[]
  avgPricePerSqftByCommunity: { community: string; avgPricePerSqft: number }[]
  avgPriceByMonth: { month: string; avgPrice: number }[]
  totalActive: number
  totalSold: number
  totalListings: number
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
  }, [])

  if (loading) return <div className="text-center text-gray-400 py-20">Loading...</div>
  if (!data) return null

  const hasData = data.totalListings > 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Market Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">Toll Brothers · Irvine, CA</p>
      </div>

      {!hasData ? (
        <div className="text-center text-gray-400 py-20 bg-white rounded-xl border border-gray-200">
          No data yet. Run the scraper to start collecting data.
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "Active Listings", value: data.totalActive, color: "text-green-700 bg-green-50" },
              { label: "Sold / Removed", value: data.totalSold, color: "text-gray-600 bg-gray-50" },
              { label: "Total Tracked", value: data.totalListings, color: "text-blue-700 bg-blue-50" },
            ].map(({ label, value, color }) => (
              <div key={label} className={`rounded-xl p-5 ${color}`}>
                <div className="text-3xl font-bold">{value}</div>
                <div className="text-sm font-medium opacity-80 mt-1">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Avg Price Trend */}
            {data.avgPriceByMonth.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Average Listing Price Over Time</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.avgPriceByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={65} />
                    <Tooltip formatter={(v) => formatPrice(Number(v))} />
                    <Line type="monotone" dataKey="avgPrice" name="Avg Price" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Homes Sold Over Time */}
            {data.soldByMonth.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Homes Sold / Removed Per Month</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.soldByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Sold" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Avg $/sqft by Community */}
            {data.avgPricePerSqftByCommunity.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Avg Price / Sqft by Community</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.avgPricePerSqftByCommunity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="community" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip formatter={(v) => `$${Number(v)}/sqft`} />
                    <Bar dataKey="avgPricePerSqft" name="$/sqft" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* New Listings Added Over Time */}
            {data.activeByMonth.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">New Listings Added Per Month</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.activeByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="New Listings" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
