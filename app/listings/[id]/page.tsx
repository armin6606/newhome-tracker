"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { formatPrice, formatNumber, daysAgo } from "@/lib/utils"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"

type PriceHistory = {
  id: number
  price: number
  changeType: string
  detectedAt: string
}

type Listing = {
  id: number
  address: string
  lotNumber: string | null
  floorPlan: string | null
  sqft: number | null
  beds: number | null
  baths: number | null
  garages: number | null
  currentPrice: number | null
  pricePerSqft: number | null
  hoaFees: number | null
  moveInDate: string | null
  schools: string | null
  incentives: string | null
  status: string
  sourceUrl: string | null
  firstDetected: string
  soldAt: string | null
  community: { name: string; city: string; state: string; builder: { name: string } }
  priceHistory: PriceHistory[]
}

const CHANGE_COLORS: Record<string, string> = {
  initial: "text-gray-600",
  increase: "text-red-600",
  decrease: "text-green-600",
}

const CHANGE_LABELS: Record<string, string> = {
  initial: "Initial price",
  increase: "Price increase",
  decrease: "Price reduction",
}

export default function ListingDetailPage() {
  const { id } = useParams()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => r.json())
      .then((data) => { setListing(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-gray-400 py-20 text-center">Loading...</div>
  if (!listing) return <div className="text-gray-400 py-20 text-center">Listing not found.</div>

  const daysListed = daysAgo(listing.firstDetected)
  const totalPriceChange =
    listing.priceHistory.length > 1
      ? listing.priceHistory[listing.priceHistory.length - 1].price - listing.priceHistory[0].price
      : 0

  const chartData = listing.priceHistory.map((ph) => ({
    date: new Date(ph.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    price: ph.price,
  }))

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-blue-600 hover:underline text-sm">← Back to listings</Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{listing.address}</h1>
            <p className="text-gray-500 mt-1">
              {listing.community.name} · {listing.community.builder.name} · {listing.community.city}, {listing.community.state}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-gray-900">{formatPrice(listing.currentPrice)}</div>
            {totalPriceChange !== 0 && (
              <div className={`text-sm font-medium mt-1 ${totalPriceChange < 0 ? "text-green-600" : "text-red-600"}`}>
                {totalPriceChange > 0 ? "+" : ""}{formatPrice(totalPriceChange)} total change
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {[
            { label: "Bedrooms", value: listing.beds ?? "—" },
            { label: "Bathrooms", value: listing.baths ?? "—" },
            { label: "Square Feet", value: formatNumber(listing.sqft) },
            { label: "Garage", value: listing.garages ? `${listing.garages} car` : "—" },
            { label: "Floor Plan", value: listing.floorPlan || "—" },
            { label: "Lot Number", value: listing.lotNumber || "—" },
            { label: "Price/sqft", value: listing.pricePerSqft ? `$${listing.pricePerSqft}` : "—" },
            { label: "HOA / month", value: formatPrice(listing.hoaFees) },
            { label: "Move-in Date", value: listing.moveInDate || "—" },
            { label: "Status", value: listing.status === "removed" ? "Sold / Removed" : "Active" },
            { label: "Days Listed", value: `${daysListed} days` },
            { label: "First Detected", value: new Date(listing.firstDetected).toLocaleDateString() },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-xs text-gray-500 font-medium">{label}</div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">{value}</div>
            </div>
          ))}
        </div>

        {listing.schools && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-500 font-medium">Schools: </span>
            <span className="text-sm text-gray-700">{listing.schools}</span>
          </div>
        )}
        {listing.incentives && (
          <div className="mt-2">
            <span className="text-xs text-gray-500 font-medium">Incentives: </span>
            <span className="text-sm text-gray-700">{listing.incentives}</span>
          </div>
        )}

        {listing.sourceUrl && (
          <div className="mt-4">
            <a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="inline-block text-sm text-blue-600 hover:underline">
              View on Toll Brothers →
            </a>
          </div>
        )}
      </div>

      {/* Price History */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Price History</h2>

        {listing.priceHistory.length === 0 ? (
          <p className="text-gray-400 text-sm">No price history recorded yet.</p>
        ) : (
          <>
            {listing.priceHistory.length > 1 && (
              <div className="mb-6 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                      width={60}
                    />
                    <Tooltip formatter={(v) => formatPrice(Number(v))} />
                    <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="space-y-3">
              {[...listing.priceHistory].reverse().map((ph, i, arr) => {
                const prev = arr[i + 1]
                const delta = prev ? ph.price - prev.price : 0
                return (
                  <div key={ph.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">
                        {new Date(ph.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className={`text-xs font-medium ${CHANGE_COLORS[ph.changeType]}`}>
                        {CHANGE_LABELS[ph.changeType] || ph.changeType}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-gray-900">{formatPrice(ph.price)}</span>
                      {delta !== 0 && (
                        <span className={`text-xs ml-2 ${delta < 0 ? "text-green-600" : "text-red-600"}`}>
                          ({delta > 0 ? "+" : ""}{formatPrice(delta)})
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {listing.soldAt && (
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      {new Date(listing.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      Sold / Removed
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
