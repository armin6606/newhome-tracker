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
  currentPrice: number | null
  pricePerSqft: number | null
  hoaFees: number | null
  moveInDate: string | null
  status: string
  firstDetected: string
  community: { name: string; city: string; state: string; builder: { name: string } }
}

function isReady(moveInDate: string | null) {
  return !!moveInDate?.toLowerCase().includes("quick")
}

function formatLot(lot: string | null) {
  if (!lot) return "—"
  return lot.replace(/home site\s*/i, "#")
}

export default function HomePage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState("currentPrice")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  // Server-side filters
  const [status, setStatus] = useState("active")
  const [minPrice, setMinPrice] = useState("")
  const [maxPrice, setMaxPrice] = useState("")
  const [minBeds, setMinBeds] = useState("")
  const [minSqft, setMinSqft] = useState("")
  const [maxSqft, setMaxSqft] = useState("")

  // Client-side filters
  const [citySearch, setCitySearch] = useState("")
  const [moveInOnly, setMoveInOnly] = useState(false)

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
    setListings(data)
    setLoading(false)
  }, [status, sortBy, sortDir, minPrice, maxPrice, minBeds, minSqft, maxSqft])

  useEffect(() => { fetchListings() }, [fetchListings])

  const displayed = listings.filter((l) => {
    if (citySearch && !l.community.city.toLowerCase().includes(citySearch.toLowerCase())) return false
    if (moveInOnly && !isReady(l.moveInDate)) return false
    return true
  })

  function handleSort(field: string) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortBy(field); setSortDir("asc") }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-amber-600 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  function resetFilters() {
    setCitySearch("")
    setStatus("active")
    setMinPrice("")
    setMaxPrice("")
    setMinBeds("")
    setMinSqft("")
    setMaxSqft("")
    setMoveInOnly(false)
  }

  return (
    <div className="flex gap-6">
      {/* Sidebar Filters */}
      <aside className="w-56 shrink-0 space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Filters</span>
            <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              ↺ Reset
            </button>
          </div>

          {/* City Search */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">City</label>
            <input
              type="text"
              placeholder="e.g. Irvine"
              value={citySearch}
              onChange={(e) => setCitySearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="active">Active</option>
              <option value="removed">Sold / Removed</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Price Range */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Price Range</label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Bedrooms */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Bedrooms</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["", "3", "4", "5"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => setMinBeds(val)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    minBeds === val
                      ? "bg-amber-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {val === "" ? "Any" : `${val}+`}
                </button>
              ))}
            </div>
          </div>

          {/* Sqft */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Square Footage</label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Min"
                value={minSqft}
                onChange={(e) => setMinSqft(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxSqft}
                onChange={(e) => setMaxSqft(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Move-In Ready */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={moveInOnly}
              onChange={(e) => setMoveInOnly(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-600"
            />
            <span className="text-sm text-gray-600">Move-In Ready only</span>
          </label>
        </div>
      </aside>

      {/* Table */}
      <div className="flex-1 min-w-0">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {loading ? "Loading..." : `${displayed.length} listing${displayed.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {[
                    { label: "Community", field: null },
                    { label: "Builder", field: null },
                    { label: "Address", field: "address" },
                    { label: "Lot", field: null },
                    { label: "Plan", field: null },
                    { label: "Bed/Bath", field: "beds" },
                    { label: "Sq Ft", field: "sqft" },
                    { label: "Price", field: "currentPrice" },
                    { label: "$/Sqft", field: "pricePerSqft" },
                    { label: "Move-In", field: null },
                    { label: "Status", field: null },
                    { label: "Listed", field: "firstDetected" },
                  ].map(({ label, field }) => (
                    <th
                      key={label}
                      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${field ? "cursor-pointer hover:text-gray-700" : ""}`}
                      onClick={field ? () => handleSort(field) : undefined}
                    >
                      {label}{field && <SortIcon field={field} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400">Loading listings...</td></tr>
                ) : displayed.length === 0 ? (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400">No listings found.</td></tr>
                ) : (
                  displayed.map((l) => (
                    <tr key={l.id} className="hover:bg-amber-50 transition-colors">
                      <td className="px-4 py-3 max-w-[180px]">
                        <span className="block truncate text-gray-800 font-medium text-xs">{l.community.name}</span>
                        <span className="text-gray-400 text-xs">{l.community.city}, {l.community.state}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{l.community.builder.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/listings/${l.id}`} className="font-medium text-gray-900 hover:text-amber-700 hover:underline">
                          {l.address}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatLot(l.lotNumber)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[120px]">
                        <span className="block truncate">{l.floorPlan || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {l.beds != null && l.baths != null ? `${l.beds}/${l.baths}` : (l.beds ?? "—")}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatNumber(l.sqft)}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{formatPrice(l.currentPrice)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={l.pricePerSqft ? "text-amber-600 font-medium" : "text-gray-400"}>
                          {l.pricePerSqft ? `$${l.pricePerSqft}` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isReady(l.moveInDate) ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 uppercase tracking-wide">Ready</span>
                        ) : (
                          <span className="text-gray-600 text-xs">{l.moveInDate || "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${l.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {l.status === "removed" ? "Sold" : l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{daysAgo(l.firstDetected)}d ago</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
