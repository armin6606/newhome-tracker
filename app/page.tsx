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
  floors: number | null
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
  const [floors, setFloors] = useState("")

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
    if (floors) params.set("floors", floors)
    const res = await fetch(`/api/listings?${params}`)
    const data: Listing[] = await res.json()
    setListings(data)
    setLoading(false)
  }, [status, sortBy, sortDir, minPrice, maxPrice, minBeds, minSqft, maxSqft, floors])

  useEffect(() => { fetchListings() }, [fetchListings])

  // Deduplicate by address (keep first occurrence = lowest id)
  const deduped = listings.filter((l, idx, arr) => {
    const norm = l.address.toLowerCase().trim()
    return arr.findIndex((x) => x.address.toLowerCase().trim() === norm) === idx
  })

  const displayed = deduped.filter((l) => {
    if (citySearch && !l.community.city.toLowerCase().includes(citySearch.toLowerCase())) return false
    if (moveInOnly && !isReady(l.moveInDate)) return false
    return true
  })

  // Stats
  const activeListings = listings.filter((l) => l.status === "active")
  const prices = activeListings.map((l) => l.currentPrice).filter((p): p is number => p != null)
  const sortedPrices = [...prices].sort((a, b) => a - b)
  const medianPrice = sortedPrices.length ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null
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
    setFloors("")
    setMoveInOnly(false)
  }

  const inputCls = "border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
  const selectCls = "border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 200 }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">New Construction Intelligence</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Track Every New Home. <span className="text-amber-300">Before They&apos;re Gone.</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Real-time inventory, price history, and sales velocity for new construction communities.
          </p>
          {!loading && (
            <div className="mt-5 flex flex-wrap gap-6">
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

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* City */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">City</label>
            <input type="text" placeholder="e.g. Irvine" value={citySearch} onChange={(e) => setCitySearch(e.target.value)} className={`${inputCls} w-28`} />
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${selectCls} w-36`}>
              <option value="active">Active</option>
              <option value="removed">Sold / Removed</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Price */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Price ($)</label>
            <div className="flex gap-1.5 items-center">
              <input type="number" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className={`${inputCls} w-24`} />
              <span className="text-stone-300 text-xs">–</span>
              <input type="number" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={`${inputCls} w-24`} />
            </div>
          </div>

          {/* Beds */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Beds</label>
            <div className="flex gap-1">
              {(["", "3", "4", "5"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => setMinBeds(val)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${minBeds === val ? "bg-amber-500 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                >
                  {val === "" ? "Any" : `${val}+`}
                </button>
              ))}
            </div>
          </div>

          {/* Sqft */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Sq Ft</label>
            <div className="flex gap-1.5 items-center">
              <input type="number" placeholder="Min" value={minSqft} onChange={(e) => setMinSqft(e.target.value)} className={`${inputCls} w-20`} />
              <span className="text-stone-300 text-xs">–</span>
              <input type="number" placeholder="Max" value={maxSqft} onChange={(e) => setMaxSqft(e.target.value)} className={`${inputCls} w-20`} />
            </div>
          </div>

          {/* Floors */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Floors</label>
            <div className="flex gap-1">
              {(["", "1", "2", "3"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => setFloors(val)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${floors === val ? "bg-amber-500 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                >
                  {val === "" ? "Any" : val}
                </button>
              ))}
            </div>
          </div>

          {/* Move-In Ready */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide invisible">Ready</label>
            <label className="flex items-center gap-2 cursor-pointer h-[34px]">
              <input type="checkbox" checked={moveInOnly} onChange={(e) => setMoveInOnly(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-sm text-stone-600 whitespace-nowrap">Move-In Ready</span>
            </label>
          </div>

          {/* Reset */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] invisible">x</label>
            <button onClick={resetFilters} className="h-[34px] px-3 rounded-lg text-xs text-stone-400 hover:text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors">
              ↺ Reset
            </button>
          </div>

          <div className="ml-auto self-end text-sm text-stone-400 whitespace-nowrap pb-0.5">
            {loading ? "Loading..." : `${displayed.length} listing${displayed.length !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
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
                  { label: "Floors", field: "floors" },
                  { label: "Sq Ft", field: "sqft" },
                  { label: "Price", field: "currentPrice" },
                  { label: "$/Sqft", field: "pricePerSqft" },
                  { label: "HOA/mo", field: null },
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
                <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">Loading listings...</td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-stone-400">No listings found.</td></tr>
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
                    <td className="px-4 py-3 text-stone-500 text-xs max-w-[130px]">
                      <span className="block truncate">{l.floorPlan || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap">
                      {l.beds != null && l.baths != null ? `${l.beds}/${l.baths}` : (l.beds ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap text-center">
                      {l.floors ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{formatNumber(l.sqft)}</td>
                    <td className="px-4 py-3 font-semibold text-stone-900 whitespace-nowrap">{formatPrice(l.currentPrice)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={l.pricePerSqft ? "text-amber-600 font-medium" : "text-stone-400"}>
                        {l.pricePerSqft ? `$${l.pricePerSqft}` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap text-xs">
                      {l.hoaFees ? `$${l.hoaFees.toLocaleString()}/mo` : "—"}
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
  )
}
