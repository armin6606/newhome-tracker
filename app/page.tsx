"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { formatPrice, formatNumber, daysAgo } from "@/lib/utils"

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
  incentives: string | null
  status: string
  firstDetected: string
  soldAt: string | null
  community: { name: string; builder: { name: string } }
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  sold: "bg-gray-100 text-gray-600",
  removed: "bg-gray-100 text-gray-600",
}

export default function HomePage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState("firstDetected")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Filters
  const [status, setStatus] = useState("active")
  const [minPrice, setMinPrice] = useState("")
  const [maxPrice, setMaxPrice] = useState("")
  const [minBeds, setMinBeds] = useState("")
  const [minSqft, setMinSqft] = useState("")
  const [maxSqft, setMaxSqft] = useState("")
  const [community, setCommunity] = useState("")
  const [communities, setCommunities] = useState<string[]>([])

  const fetchListings = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("status", status)
    params.set("sortBy", sortBy)
    params.set("sortDir", sortDir)
    if (minPrice) params.set("minPrice", minPrice)
    if (maxPrice) params.set("maxPrice", maxPrice)
    if (minBeds) params.set("minBeds", minBeds)
    if (minSqft) params.set("minSqft", minSqft)
    if (maxSqft) params.set("maxSqft", maxSqft)

    const res = await fetch(`/api/listings?${params}`)
    const data: Listing[] = await res.json()
    const all = community ? data.filter((l) => l.community.name === community) : data
    setListings(all)
    const names = [...new Set(data.map((l) => l.community.name))].sort()
    setCommunities(names)
    setLoading(false)
  }, [status, sortBy, sortDir, minPrice, maxPrice, minBeds, minSqft, maxSqft, community])

  useEffect(() => { fetchListings() }, [fetchListings])

  function handleSort(field: string) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortBy(field); setSortDir("asc") }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-blue-600 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New Construction Homes</h1>
        <p className="text-gray-500 text-sm mt-1">Toll Brothers · Irvine, CA · Updated daily</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="active">Active</option>
              <option value="removed">Sold / Removed</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Min Price</label>
            <input type="number" placeholder="e.g. 800000" value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Max Price</label>
            <input type="number" placeholder="e.g. 2000000" value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Min Beds</label>
            <select value={minBeds} onChange={(e) => setMinBeds(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Any</option>
              <option value="2">2+ Beds</option>
              <option value="3">3+ Beds</option>
              <option value="4">4+ Beds</option>
              <option value="5">5+ Beds</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sqft Range</label>
            <select onChange={(e) => {
              const [min, max] = e.target.value.split("-")
              setMinSqft(min || ""); setMaxSqft(max || "")
            }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="-">Any</option>
              <option value="1500-2000">1,500–2,000</option>
              <option value="2000-3000">2,000–3,000</option>
              <option value="3000-">3,000+</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Community</label>
            <select value={community} onChange={(e) => setCommunity(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All</option>
              {communities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {loading ? "Loading..." : `${listings.length} listings`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {[
                  { label: "Address", field: "address", align: "left" },
                  { label: "Community", field: null, align: "left" },
                  { label: "Plan", field: null, align: "left" },
                  { label: "Beds", field: "beds", align: "right" },
                  { label: "Sqft", field: "sqft", align: "right" },
                  { label: "Price", field: "currentPrice", align: "right" },
                  { label: "$/sqft", field: "pricePerSqft", align: "right" },
                  { label: "HOA/mo", field: null, align: "right" },
                  { label: "Move-in", field: null, align: "left" },
                  { label: "Status", field: null, align: "center" },
                  { label: "Listed", field: "firstDetected", align: "right" },
                ].map(({ label, field, align }) => (
                  <th key={label}
                    className={`px-4 py-3 font-medium text-gray-600 whitespace-nowrap text-${align} ${field ? "cursor-pointer hover:text-gray-900" : ""}`}
                    onClick={field ? () => handleSort(field) : undefined}>
                    {label}{field && <SortIcon field={field} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400">Loading listings...</td></tr>
              ) : listings.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400">
                  No listings found. Run the scraper to populate data.
                </td></tr>
              ) : (
                listings.map((l) => (
                  <tr key={l.id} className="hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/listings/${l.id}`} className="font-medium text-blue-700 hover:underline">
                        {l.address}
                      </Link>
                      {l.lotNumber && <span className="text-gray-400 text-xs ml-1">Lot {l.lotNumber}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{l.community.name}</td>
                    <td className="px-4 py-3 text-gray-600">{l.floorPlan || "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{l.beds ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatNumber(l.sqft)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatPrice(l.currentPrice)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{l.pricePerSqft ? `$${l.pricePerSqft}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{l.hoaFees ? `$${l.hoaFees}` : "—"}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{l.moveInDate || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[l.status] || "bg-gray-100 text-gray-600"}`}>
                        {l.status === "removed" ? "Sold" : l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs whitespace-nowrap">
                      {daysAgo(l.firstDetected)}d ago
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
