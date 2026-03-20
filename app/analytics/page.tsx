"use client"

import { useEffect, useState, useCallback } from "react"
import { formatPrice } from "@/lib/utils"
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts"

// Refined color palette — saturated enough to read clearly, not garish
const CHART_COLORS = [
  "#4D8EC8", "#59AE7F", "#C49040", "#8B65C8", "#3EAAAA",
  "#C4B040", "#C46060", "#5070C8", "#52A87E", "#C47840",
  "#8848A8", "#3EA0C0", "#A09038", "#A85878", "#5888C8",
]

type Community = {
  name: string; builderName: string; active: number; sold: number; total: number;
  avgPrice: number | null; minPrice: number | null; maxPrice: number | null;
  avgPpsqft: number | null; avgSqft: number | null;
}

type AnalyticsData = {
  scatterData: { sqft: number; price: number; community: string }[]
  avgPricePerSqftByCommunity: { community: string; avgPricePerSqft: number }[]
  priceRangeByCommunity: { community: string; min: number; max: number; avg: number; count: number }[]
  avgPriceByMonth: { month: string; avgPrice: number }[]
  soldByMonth: { month: string; count: number }[]
  communitySummary: Community[]
  totalActive: number; totalSold: number; totalListings: number;
}

type MetaData = {
  cities: string[]
  builders: string[]
  communities: string[]
}

function shortName(name: string): string {
  return name
    .replace(/^toll brothers\s+(at|in|by|of)\s+/i, "")
    .replace(/\s+by\s+toll brothers$/i, "")
    .replace(/^toll brothers\s+/i, "")
    .replace(/great park neighborhoods/i, "Great Park")
    .trim()
}

function builderColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "text-[#1B4FA8] font-semibold"
  if (name.toLowerCase().includes("toll")) return "text-[#C9940A] font-semibold"
  return "text-stone-600"
}

const selectCls = "border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent bg-white text-stone-700 cursor-pointer"

function fmtPrice(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

export default function AnalyticsPage() {
  const [data, setData]           = useState<AnalyticsData | null>(null)
  const [meta, setMeta]           = useState<MetaData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [cityFilter, setCityFilter]           = useState("")
  const [builderFilter, setBuilderFilter]     = useState("")
  const [communityFilter, setCommunityFilter] = useState("")

  // Fetch dropdown options once on mount
  useEffect(() => {
    fetch("/api/analytics/meta")
      .then((r) => r.json())
      .then(setMeta)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (cityFilter)      params.set("city",      cityFilter)
    if (builderFilter)   params.set("builder",   builderFilter)
    if (communityFilter) params.set("community", communityFilter)
    const res = await fetch(`/api/analytics?${params}`)
    setData(await res.json())
    setLoading(false)
  }, [cityFilter, builderFilter, communityFilter])

  useEffect(() => { fetchData() }, [fetchData])

  function resetFilters() {
    setCityFilter("")
    setBuilderFilter("")
    setCommunityFilter("")
  }

  const ppsqftHeight    = data ? Math.max(260, data.avgPricePerSqftByCommunity.length * 48) : 260
  const priceRangeHeight = data ? Math.max(260, data.priceRangeByCommunity.length * 48)     : 260

  // Group scatter data by community for per-community colors
  const scatterByCommunity = (data?.scatterData ?? []).reduce((acc, pt) => {
    if (!acc[pt.community]) acc[pt.community] = []
    acc[pt.community].push(pt)
    return acc
  }, {} as Record<string, { sqft: number; price: number; community: string }[]>)
  const scatterCommunities = Object.keys(scatterByCommunity)

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 200 }}>
        <div className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1600&q=80')" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Market Intelligence</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Analytics & <span className="text-amber-300">Market Trends</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Price trends, sales velocity, and community-level insights — active listings only.
          </p>
          {!loading && data && (
            <div className="mt-5 flex flex-wrap gap-6">
              {[
                { label: "Communities",    value: data.communitySummary.length.toString() },
                { label: "Active Listings", value: data.totalActive.toString() },
                { label: "Sold / Removed", value: data.totalSold.toString() },
                { label: "Total Tracked",  value: data.totalListings.toString() },
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

      {/* Filters */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-3 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          {/* City */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">City</label>
            <select value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setCommunityFilter("") }}
              className={`${selectCls} w-32`}>
              <option value="">All Cities</option>
              {meta?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Builder */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Builder</label>
            <select value={builderFilter} onChange={(e) => { setBuilderFilter(e.target.value); setCommunityFilter("") }}
              className={`${selectCls} w-36`}>
              <option value="">All Builders</option>
              {meta?.builders.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          {/* Community */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Community</label>
            <select value={communityFilter} onChange={(e) => setCommunityFilter(e.target.value)}
              className={`${selectCls} w-52`}>
              <option value="">All Communities</option>
              {meta?.communities
                .filter((c) => {
                  if (cityFilter && !c.toLowerCase().includes(cityFilter.toLowerCase())) {
                    // We can't easily filter community names by city here without extra data
                    // so show all and let the API handle it
                  }
                  return true
                })
                .map((c) => <option key={c} value={c}>{shortName(c)}</option>)}
            </select>
          </div>
          {/* Reset */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] invisible">x</label>
            <button onClick={resetFilters}
              className="h-[34px] px-3 rounded-lg text-xs text-stone-400 hover:text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors">
              ↺ Reset
            </button>
          </div>
          {!loading && data && (
            <div className="ml-auto self-end text-sm text-stone-400 pb-0.5">
              {data.totalListings} listings across {data.communitySummary.length} communities
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-stone-400 py-20">Loading analytics...</div>}
      {!loading && data && (
        <>
          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            {/* 1. Price vs Square Footage — per-community colors */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Price vs Square Footage</h2>
              <p className="text-xs text-stone-400 mb-4">Active listings only — each dot = one home</p>
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" dataKey="sqft" name="Sqft"
                    domain={[900, "auto"]}
                    ticks={[900, 1900, 2900, 3900, 4900, 5900]}
                    tickFormatter={(v) => v.toLocaleString()}
                    tick={{ fontSize: 11 }}
                    label={{ value: "Sq Ft", position: "insideBottomRight", offset: -4, fontSize: 11, fill: "#78716c" }} />
                  <YAxis type="number" dataKey="price" name="Price"
                    tickFormatter={fmtPrice}
                    tick={{ fontSize: 11 }} width={62} />
                  <ZAxis range={[30, 30]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }}
                    formatter={(v, name) => name === "Price" ? formatPrice(Number(v)) : `${Number(v).toLocaleString()} sqft`}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.community ? shortName(payload[0].payload.community) : ""} />
                  {scatterCommunities.map((name, i) => (
                    <Scatter
                      key={name}
                      name={shortName(name)}
                      data={scatterByCommunity[name]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      opacity={0.8}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
              {/* Legend */}
              {scatterCommunities.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-stone-100">
                  {scatterCommunities.map((name, i) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full flex-none"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-[11px] text-stone-500">{shortName(name)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Avg $/sqft by Community */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Avg Price / Sqft by Community</h2>
              <p className="text-xs text-stone-400 mb-4">Active listings only</p>
              <ResponsiveContainer width="100%" height={ppsqftHeight}>
                <BarChart
                  data={data.avgPricePerSqftByCommunity.map((d) => ({ ...d, community: shortName(d.community) }))}
                  layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" domain={[500, "auto"]} tickFormatter={(v) => `$${v.toLocaleString()}`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="community" tick={{ fontSize: 11 }} width={130} interval={0} />
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}/sqft`} />
                  <Bar dataKey="avgPricePerSqft" name="$/sqft" radius={[0, 4, 4, 0]}>
                    {data.avgPricePerSqftByCommunity.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 3. Price Range by Community */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Price Range by Community</h2>
              <p className="text-xs text-stone-400 mb-4">Min · Avg · Max — active listings only</p>
              <ResponsiveContainer width="100%" height={priceRangeHeight}>
                <BarChart
                  data={data.priceRangeByCommunity.map((d) => ({ ...d, community: shortName(d.community) }))}
                  layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" domain={[500000, "auto"]} tickFormatter={fmtPrice} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="community" tick={{ fontSize: 11 }} width={130} interval={0} />
                  <Tooltip formatter={(v) => formatPrice(Number(v))} />
                  <Bar dataKey="min"  name="Min"  fill="#59AE7F" radius={[0, 0, 0, 0]} stackId="a" />
                  <Bar dataKey="avg"  name="Avg"  fill="#C4B040" radius={[0, 0, 0, 0]} stackId="b" />
                  <Bar dataKey="max"  name="Max"  fill="#C46060" radius={[0, 4, 4, 0]} stackId="c" />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 pt-2 border-t border-stone-100">
                {[{ label: "Min", color: "#59AE7F" }, { label: "Avg", color: "#C4B040" }, { label: "Max", color: "#C46060" }].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-none" style={{ backgroundColor: color }} />
                    <span className="text-[11px] text-stone-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Price Over Time */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Average Price Over Time</h2>
              <p className="text-xs text-stone-400 mb-4">Monthly avg of active listing prices</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.avgPriceByMonth} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip formatter={(v) => formatPrice(Number(v))} />
                  <Line type="monotone" dataKey="avgPrice" name="Avg Price"
                    stroke="#6B9AC4" strokeWidth={2.5} dot={{ r: 4, fill: "#6B9AC4" }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 5. Sales Trend */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm lg:col-span-2">
              <h2 className="font-semibold text-stone-900 mb-1">Sales Trend</h2>
              <p className="text-xs text-stone-400 mb-4">Listings marked sold or removed from builder site per month</p>
              {data.soldByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.soldByMonth} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Sold" radius={[4, 4, 0, 0]}>
                      {data.soldByMonth.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">
                  No sold data yet — will populate as homes are marked removed.
                </div>
              )}
            </div>
          </div>

          {/* Community Summary Table */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-900 text-base">Community Summary</h2>
              <p className="text-xs text-stone-400 mt-0.5">{data.communitySummary.length} communities — prices reflect active listings only</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    {["Community", "Builder", "Active", "Sold", "Avg Price", "Price Range", "Avg $/Sqft", "Avg Sqft"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.communitySummary.map((c, idx) => (
                    <tr key={c.name} className={idx % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                      <td className="px-4 py-3 font-medium text-stone-900 max-w-[200px]">
                        <span className="block truncate">{shortName(c.name)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={builderColor(c.builderName)}>{c.builderName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">{c.active}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-500">{c.sold}</span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-stone-900 whitespace-nowrap">{c.avgPrice ? formatPrice(c.avgPrice) : "—"}</td>
                      <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-xs">
                        {c.minPrice && c.maxPrice ? `${formatPrice(c.minPrice)} – ${formatPrice(c.maxPrice)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{c.avgPpsqft ? `$${c.avgPpsqft.toLocaleString()}` : "—"}</td>
                      <td className="px-4 py-3 text-stone-700 whitespace-nowrap">{c.avgSqft ? c.avgSqft.toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
