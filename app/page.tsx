"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { formatPrice, formatNumber } from "@/lib/utils"

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
  return lot.replace(/home site\s*/i, "").trim() || "—"
}

function cleanCommunityName(name: string): string {
  return name
    .replace(/^toll brothers\s+(at|in|by|of)\s+/i, "")
    .replace(/\s+by\s+toll brothers$/i, "")
    .replace(/^toll brothers\s+/i, "")
    .trim()
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

  // Stats derived from all active listings (pre city filter)
  const activeListings = listings.filter((l) => l.status === "active")
  const prices = activeListings.map((l) => l.currentPrice).filter((p): p is number => p != null)
  const sortedPrices = [...prices].sort((a, b) => a - b)
  const medianPrice = sortedPrices.length
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : null
  const ppsqValues = activeListings.map((l) => l.pricePerSqft).filter((p): p is number => p != null)
  const avgPpsq = ppsqValues.length ? Math.round(ppsqValues.reduce((a, b) => a + b, 0) / ppsqValues.length) : null
  const communities = new Set(activeListings.map((l) => l.community.name)).size
  const readyCount = activeListings.filter((l) => isReady(l.moveInDate)).length

  function handleSort(field: string) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortBy(field); setSortDir("asc") }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-amber-500 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
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
    <div>
      {/* Hero */}
      <div
        className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-8"
        style={{ minHeight: 220 }}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-12">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-2">
            New Construction Intelligence
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-3">
            Track Every New Home.<br />
            <span className="text-amber-300">Before They&apos;re Gone.</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-lg">
            Real-time inventory, price history, and sales velocity for new construction communities.
            We preserve every listing — even after it&apos;s sold.
          </p>

          {/* Stats bar */}
          {!loading && (
            <div className="mt-6 flex flex-wrap gap-6">
              {[
                { label: "Active Listings", value: activeListings.length.toString() },
                { label: "Median Price", value: medianPrice ? formatPrice(medianPrice) : "—" },
                { label: "Avg $/Sqft", value: avgPpsq ? `$${avgPpsq}` : "—" },
                { label: "Communities", value: communities.toString() },
                { label: "Move-In Ready", value: readyCount.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col">
                  <span className="text-amber-400 font-bold text-lg leading-none">{value}</span>
                  <span className="text-stone-400 text-xs mt-0.5">{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex gap-6">
        {/* Sidebar Filters */}
        <aside className="w-52 shrink-0 space-y-5">
          <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-700 uppercase tracking-wide">Filters</span>
              <button onClick={resetFilters} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                ↺ Reset
              </button>
            </div>

            {/* City Search */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">City</label>
              <input
                type="text"
                placeholder="e.g. Irvine"
                value={citySearch}
                onChange={(e) => setCitySearch(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="active">Active</option>
                <option value="removed">Sold / Removed</option>
                <option value="all">All</option>
              </select>
            </div>

            {/* Price Range */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Price Range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Bedrooms */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Bedrooms</label>
              <div className="flex gap-1.5 flex-wrap">
                {(["", "3", "4", "5"] as const).map((val) => (
                  <button
                    key={val}
                    onClick={() => setMinBeds(val)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      minBeds === val
                        ? "bg-amber-500 text-white"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    }`}
                  >
                    {val === "" ? "Any" : `${val}+`}
                  </button>
                ))}
              </div>
            </div>

            {/* Sqft */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Square Footage</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={minSqft}
                  onChange={(e) => setMinSqft(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={maxSqft}
                  onChange={(e) => setMaxSqft(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Move-In Ready */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={moveInOnly}
                onChange={(e) => setMoveInOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500"
              />
              <span className="text-sm text-stone-600">Move-In Ready only</span>
            </label>
          </div>
        </aside>

        {/* Table */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
              <span className="text-sm text-stone-500">
                {loading ? "Loading..." : `${displayed.length} listing${displayed.length !== 1 ? "s" : ""}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
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
                    ].map(({ label, field }) => (
                      <th
                        key={label}
                        className={`px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap ${field ? "cursor-pointer hover:text-stone-700" : ""}`}
                        onClick={field ? () => handleSort(field) : undefined}
                      >
                        {label}{field && <SortIcon field={field} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-stone-400">Loading listings...</td></tr>
                  ) : displayed.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-stone-400">No listings found.</td></tr>
                  ) : (
                    displayed.map((l) => (
                      <tr key={l.id} className="hover:bg-amber-50/50 transition-colors">
                        <td className="px-4 py-3 max-w-[160px]">
                          <span className="block truncate text-stone-800 font-medium text-xs">{cleanCommunityName(l.community.name)}</span>
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{l.community.builder.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link href={`/listings/${l.id}`} className="font-medium text-stone-900 hover:text-amber-700 hover:underline">
                            {l.address}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{formatLot(l.lotNumber)}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs max-w-[120px]">
                          <span className="block truncate">{l.floorPlan || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-stone-700 whitespace-nowrap">
                          {l.beds != null && l.baths != null ? `${l.beds}/${l.baths}` : (l.beds ?? "—")}
                        </td>
                        <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{formatNumber(l.sqft)}</td>
                        <td className="px-4 py-3 font-semibold text-stone-900 whitespace-nowrap">{formatPrice(l.currentPrice)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={l.pricePerSqft ? "text-amber-600 font-medium" : "text-stone-400"}>
                            {l.pricePerSqft ? `$${l.pricePerSqft}` : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isReady(l.moveInDate) ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wide">Ready</span>
                          ) : (
                            <span className="text-stone-600 text-xs">{l.moveInDate || "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
