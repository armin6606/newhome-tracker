"use client"

import { useState, useEffect, useCallback } from "react"
import { formatPrice } from "@/lib/utils"

type IncentiveCommunity = {
  id: number
  name: string
  city: string
  state: string
  url: string
  builder: { name: string }
  incentives: string
  activeCount: number
  minPrice: number | null
  maxPrice: number | null
}

function cleanCommunityName(name: string): string {
  return name
    .replace(/^toll brothers\s+(at|in|by|of)\s+/i, "")
    .replace(/\s+by\s+toll brothers$/i, "")
    .replace(/^toll brothers\s+/i, "")
    .trim()
}

function builderColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "font-semibold text-[#1B4FA8]"
  if (name.toLowerCase().includes("toll")) return "font-semibold text-[#C9940A]"
  return "text-stone-600"
}

function builderBadgeColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "bg-blue-50 text-blue-700 border-blue-200"
  if (name.toLowerCase().includes("toll")) return "bg-amber-50 text-amber-700 border-amber-200"
  return "bg-stone-100 text-stone-600 border-stone-200"
}

export default function IncentivesPage() {
  const [communities, setCommunities] = useState<IncentiveCommunity[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState("community")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [citySearch, setCitySearch] = useState("")
  const [builderSearch, setBuilderSearch] = useState("")

  const fetchIncentives = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ sortBy, sortDir })
    if (citySearch) params.set("city", citySearch)
    if (builderSearch) params.set("builder", builderSearch)
    const res = await fetch(`/api/incentives?${params}`)
    const data = await res.json()
    setCommunities(data)
    setLoading(false)
  }, [sortBy, sortDir, citySearch, builderSearch])

  useEffect(() => { fetchIncentives() }, [fetchIncentives])

  function handleSort(field: string) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortBy(field); setSortDir("asc") }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">↕</span>
    return <span className="text-amber-500 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  const inputCls = "border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
  const totalOffers = communities.length
  const uniqueBuilders = new Set(communities.map((c) => c.builder.name)).size

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 160 }}>
        <div className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1560520653-9e0e4c89eb11?auto=format&fit=crop&w=1600&q=80')" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Builder Offers</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Current Incentives & <span className="text-amber-300">Special Offers</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Active builder promotions — rate buydowns, closing cost credits, upgrade packages, and more.
          </p>
          {!loading && (
            <div className="mt-4 flex gap-6">
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{totalOffers}</span>
                <span className="text-stone-400 text-xs mt-0.5">Communities with Offers</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{uniqueBuilders}</span>
                <span className="text-stone-400 text-xs mt-0.5">Builders</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">
                  {communities.reduce((s, c) => s + c.activeCount, 0)}
                </span>
                <span className="text-stone-400 text-xs mt-0.5">Active Listings</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">City</label>
            <input type="text" placeholder="e.g. Irvine" value={citySearch}
              onChange={(e) => setCitySearch(e.target.value)} className={`${inputCls} w-28`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Builder</label>
            <input type="text" placeholder="e.g. Lennar" value={builderSearch}
              onChange={(e) => setBuilderSearch(e.target.value)} className={`${inputCls} w-32`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] invisible">x</label>
            <button onClick={() => { setCitySearch(""); setBuilderSearch("") }}
              className="h-[34px] px-3 rounded-lg text-xs text-stone-400 hover:text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors">
              ↺ Reset
            </button>
          </div>
          <div className="ml-auto self-end text-sm text-stone-400 whitespace-nowrap pb-0.5">
            {loading ? "Loading..." : `${totalOffers} offer${totalOffers !== 1 ? "s" : ""}`}
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
                  { label: "Community", field: "community" },
                  { label: "City", field: "city" },
                  { label: "Builder", field: "builder" },
                  { label: "Listings", field: null },
                  { label: "Price Range", field: null },
                  { label: "Current Offer / Incentive", field: null },
                ].map(({ label, field }) => (
                  <th key={label}
                    className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-stone-500 ${field ? "cursor-pointer hover:text-stone-700" : ""}`}
                    onClick={field ? () => handleSort(field) : undefined}>
                    {label}{field && <SortIcon field={field} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">Loading incentives...</td></tr>
              ) : communities.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                  No active incentives found. Run the incentive scraper to populate.
                </td></tr>
              ) : (
                communities.map((c, idx) => (
                  <tr key={c.id} className={`hover:bg-amber-50/40 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-stone-50/50"}`}>
                    {/* Community */}
                    <td className="px-4 py-4 max-w-[200px]">
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-stone-800 hover:text-amber-700 hover:underline leading-tight block truncate">
                        {cleanCommunityName(c.name)}
                      </a>
                    </td>
                    {/* City */}
                    <td className="px-4 py-4 text-stone-500 whitespace-nowrap">{c.city}, {c.state}</td>
                    {/* Builder */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${builderBadgeColor(c.builder.name)}`}>
                        <span className={builderColor(c.builder.name)}>{c.builder.name}</span>
                      </span>
                    </td>
                    {/* Listing count */}
                    <td className="px-4 py-4 text-stone-500 text-center whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-stone-100 text-stone-600 text-xs font-semibold">
                        {c.activeCount}
                      </span>
                    </td>
                    {/* Price range */}
                    <td className="px-4 py-4 whitespace-nowrap text-stone-700 font-medium">
                      {c.minPrice && c.maxPrice ? (
                        c.minPrice === c.maxPrice
                          ? formatPrice(c.minPrice)
                          : <>{formatPrice(c.minPrice)}<span className="text-stone-400 font-normal mx-1">–</span>{formatPrice(c.maxPrice)}</>
                      ) : "—"}
                    </td>
                    {/* Incentive */}
                    <td className="px-4 py-4 max-w-sm">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex-none w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-stone-700 leading-snug">{c.incentives}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-stone-400 text-right">
        Incentives sourced directly from builder websites. Offers subject to change — verify with builder for current terms.
      </p>
    </div>
  )
}
