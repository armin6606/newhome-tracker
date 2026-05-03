"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { formatPrice, cleanCommunityName } from "@/lib/utils"
import { ContentGate } from "@/app/_components/ContentGate"
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ComposedChart, Area,
  Legend,
} from "recharts"

const CHART_COLORS = [
  "#4D8EC8", "#59AE7F", "#C49040", "#8B65C8", "#3EAAAA",
  "#C4B040", "#C46060", "#5070C8", "#52A87E", "#C47840",
  "#8848A8", "#3EA0C0", "#A09038", "#A85878", "#5888C8",
]

// ── City → County map (client-side, same as server) ──────────────────────────
const CITY_COUNTY: Record<string, string> = {
  "irvine": "Orange County", "orange": "Orange County", "anaheim": "Orange County",
  "tustin": "Orange County", "fullerton": "Orange County", "garden grove": "Orange County",
  "huntington beach": "Orange County", "newport beach": "Orange County", "lake forest": "Orange County",
  "mission viejo": "Orange County", "aliso viejo": "Orange County", "laguna niguel": "Orange County",
  "rancho mission viejo": "Orange County", "yorba linda": "Orange County", "brea": "Orange County",
  "long beach": "Los Angeles County", "los angeles": "Los Angeles County", "torrance": "Los Angeles County",
  "hacienda heights": "Los Angeles County", "chino hills": "San Bernardino County",
  "french valley": "Riverside County", "murrieta": "Riverside County", "temecula": "Riverside County",
  "menifee": "Riverside County", "riverside": "Riverside County", "moreno valley": "Riverside County",
  "perris": "Riverside County", "winchester": "Riverside County", "wildomar": "Riverside County",
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Community = {
  name: string; builderName: string; active: number; sold: number; total: number;
  avgPrice: number | null; minPrice: number | null; maxPrice: number | null;
  avgPpsqft: number | null; avgSqft: number | null;
}

type AnalyticsData = {
  avgPricePerSqftByCommunity: { community: string; avgPricePerSqft: number }[]
  priceRangeByCommunity: { community: string; min: number; max: number; avg: number; count: number }[]
  avgPriceByMonth: { month: string; avgPrice: number }[]
  soldByMonth: { month: string; count: number }[]
  soldByWeek: { week: string; sold: number; newListings: number }[]
  communitySummary: Community[]
  totalActive: number; totalSold: number; totalListings: number;
}

type MetaData = {
  cities: string[]
  builders: string[]
  communities: string[]
  counties: string[]
}

type ChartFilters = {
  builders: string[]
  cities: string[]
  counties: string[]
  communities: string[]
}

const EMPTY_FILTERS: ChartFilters = { builders: [], cities: [], counties: [], communities: [] }

function hasAnyFilter(f: ChartFilters) {
  return f.builders.length > 0 || f.cities.length > 0 || f.counties.length > 0 || f.communities.length > 0
}

function filtersToParams(f: ChartFilters): URLSearchParams {
  const p = new URLSearchParams()
  f.builders.forEach((b) => p.append("builder", b))
  f.cities.forEach((c) => p.append("city", c))
  f.counties.forEach((co) => p.append("county", co))
  f.communities.forEach((c) => p.append("community", c))
  return p
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const shortName = cleanCommunityName

function builderColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "text-[#1B4FA8] font-semibold"
  if (name.toLowerCase().includes("toll")) return "text-[#C9940A] font-semibold"
  return "text-stone-600"
}

function fmtPrice(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v}`
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange, placeholder, width = "w-44",
}: {
  label?: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  placeholder: string
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  function toggle(val: string) {
    if (selected.includes(val)) onChange(selected.filter((x) => x !== val))
    else onChange([...selected, val])
  }

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      {label && (
        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`${width} flex items-center justify-between gap-1 border border-stone-200 rounded-lg px-3 py-1.5 text-sm bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-colors`}
        >
          <span className={`truncate ${selected.length === 0 ? "text-stone-400" : ""}`}>{displayText}</span>
          <svg className={`w-3.5 h-3.5 flex-none text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg min-w-full max-h-60 overflow-y-auto">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-amber-50 border-b border-stone-100 font-medium"
              >
                ✕ Clear all
              </button>
            )}
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer"
                />
                <span className="text-sm text-stone-700 truncate">{opt}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Per-chart filter bar ──────────────────────────────────────────────────────
function ChartFilterBar({
  filters, onChange, meta, loading,
}: {
  filters: ChartFilters
  onChange: (f: ChartFilters) => void
  meta: MetaData | null
  loading?: boolean
}) {
  const active = hasAnyFilter(filters)
  return (
    <div className={`flex flex-wrap items-center gap-2 py-2.5 px-3 rounded-lg mb-4 border transition-colors ${
      active ? "bg-amber-50 border-amber-200" : "bg-stone-50 border-stone-100"
    }`}>
      <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mr-0.5">
        {loading ? "Loading…" : "Filter chart:"}
      </span>
      <MultiSelect
        options={meta?.builders ?? []}
        selected={filters.builders}
        onChange={(v) => onChange({ ...filters, builders: v })}
        placeholder="Builder"
        width="w-32"
      />
      <MultiSelect
        options={meta?.cities ?? []}
        selected={filters.cities}
        onChange={(v) => onChange({ ...filters, cities: v })}
        placeholder="City"
        width="w-28"
      />
      <MultiSelect
        options={meta?.counties ?? []}
        selected={filters.counties}
        onChange={(v) => onChange({ ...filters, counties: v })}
        placeholder="County"
        width="w-36"
      />
      <MultiSelect
        options={(meta?.communities ?? []).map(shortName)}
        selected={filters.communities}
        onChange={(v) => onChange({ ...filters, communities: v })}
        placeholder="Community"
        width="w-44"
      />
      {active && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1.5 rounded border border-amber-200 bg-white hover:bg-amber-50 transition-colors"
        >
          ↺ Clear
        </button>
      )}
      {active && (
        <div className="ml-auto flex gap-1 flex-wrap">
          {filters.builders.map((b)   => <span key={b}  className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">{b}</span>)}
          {filters.cities.map((c)     => <span key={c}  className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium">{c}</span>)}
          {filters.counties.map((co)  => <span key={co} className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-medium">{co}</span>)}
          {filters.communities.map((c)=> <span key={c}  className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">{c}</span>)}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData]       = useState<AnalyticsData | null>(null)
  const [meta, setMeta]       = useState<MetaData | null>(null)
  const [loading, setLoading] = useState(true)

  // Global filters
  const [cities, setCities]             = useState<string[]>(["Irvine"])
  const [builders, setBuilders]         = useState<string[]>(["Toll Brothers"])
  const [communities, setCommunities]   = useState<string[]>([])
  const [counties, setCounties]         = useState<string[]>([])

  // Per-chart filter state
  const [avgPriceFilters, setAvgPriceFilters]     = useState<ChartFilters>(EMPTY_FILTERS)
  const [salesPaceFilters, setSalesPaceFilters]   = useState<ChartFilters>(EMPTY_FILTERS)
  const [salesTrendFilters, setSalesTrendFilters] = useState<ChartFilters>(EMPTY_FILTERS)

  // Per-chart override data (null = use global data)
  const [avgPriceData, setAvgPriceData]     = useState<AnalyticsData | null>(null)
  const [salesPaceData, setSalesPaceData]   = useState<AnalyticsData | null>(null)
  const [salesTrendData, setSalesTrendData] = useState<AnalyticsData | null>(null)

  // Per-chart loading states
  const [avgPriceLoading, setAvgPriceLoading]     = useState(false)
  const [salesPaceLoading, setSalesPaceLoading]   = useState(false)
  const [salesTrendLoading, setSalesTrendLoading] = useState(false)

  useEffect(() => {
    fetch("/api/analytics/meta")
      .then((r) => r.json())
      .then(setMeta)
  }, [])

  // Global data fetch
  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    cities.forEach((c) => params.append("city", c))
    builders.forEach((b) => params.append("builder", b))
    communities.forEach((c) => params.append("community", c))
    counties.forEach((co) => params.append("county", co))
    const res = await fetch(`/api/analytics?${params}`)
    setData(await res.json())
    setLoading(false)
  }, [cities, builders, communities, counties])

  useEffect(() => { fetchData() }, [fetchData])

  // Per-chart fetches
  useEffect(() => {
    if (!hasAnyFilter(avgPriceFilters)) { setAvgPriceData(null); return }
    setAvgPriceLoading(true)
    fetch(`/api/analytics?${filtersToParams(avgPriceFilters)}`)
      .then((r) => r.json())
      .then((d) => { setAvgPriceData(d); setAvgPriceLoading(false) })
      .catch(() => setAvgPriceLoading(false))
  }, [avgPriceFilters])

  useEffect(() => {
    if (!hasAnyFilter(salesPaceFilters)) { setSalesPaceData(null); return }
    setSalesPaceLoading(true)
    fetch(`/api/analytics?${filtersToParams(salesPaceFilters)}`)
      .then((r) => r.json())
      .then((d) => { setSalesPaceData(d); setSalesPaceLoading(false) })
      .catch(() => setSalesPaceLoading(false))
  }, [salesPaceFilters])

  useEffect(() => {
    if (!hasAnyFilter(salesTrendFilters)) { setSalesTrendData(null); return }
    setSalesTrendLoading(true)
    fetch(`/api/analytics?${filtersToParams(salesTrendFilters)}`)
      .then((r) => r.json())
      .then((d) => { setSalesTrendData(d); setSalesTrendLoading(false) })
      .catch(() => setSalesTrendLoading(false))
  }, [salesTrendFilters])

  function resetFilters() {
    setCities([]); setBuilders([]); setCommunities([]); setCounties([])
  }

  const hasGlobalFilters = cities.length > 0 || builders.length > 0 || communities.length > 0 || counties.length > 0
  const ppsqftHeight    = 320


  // Resolved chart data (per-chart override or global fallback)
  const avgPriceMonthData  = (avgPriceData ?? data)?.avgPriceByMonth  ?? []
  const salesPaceWeekData  = (salesPaceData ?? data)?.soldByWeek      ?? []
  const salesTrendMonthData = (salesTrendData ?? data)?.soldByMonth   ?? []

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

      <ContentGate>
      {/* Global Filters */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-3 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelect
            label="City"
            options={meta?.cities ?? []}
            selected={cities}
            onChange={(v) => { setCities(v); setCommunities([]) }}
            placeholder="All Cities"
            width="w-36"
          />
          <MultiSelect
            label="County"
            options={meta?.counties ?? []}
            selected={counties}
            onChange={(v) => { setCounties(v); setCommunities([]) }}
            placeholder="All Counties"
            width="w-40"
          />
          <MultiSelect
            label="Builder"
            options={meta?.builders ?? []}
            selected={builders}
            onChange={(v) => { setBuilders(v); setCommunities([]) }}
            placeholder="All Builders"
            width="w-40"
          />
          <MultiSelect
            label="Community"
            options={(meta?.communities ?? []).map(shortName)}
            selected={communities}
            onChange={setCommunities}
            placeholder="All Communities"
            width="w-52"
          />
          {/* Reset */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] invisible">x</label>
            <button
              onClick={resetFilters}
              className={`h-[34px] px-3 rounded-lg text-xs border transition-colors ${
                hasGlobalFilters
                  ? "text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100"
                  : "text-stone-400 border-stone-200 hover:bg-stone-50 hover:text-stone-600"
              }`}
            >
              ↺ Reset
            </button>
          </div>
          {!loading && data && (
            <div className="ml-auto self-end text-sm text-stone-400 pb-0.5">
              {data.totalListings} listings across {data.communitySummary.length} communities
            </div>
          )}
        </div>
        {/* Active filter chips */}
        {hasGlobalFilters && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-stone-100">
            {cities.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                {c}
                <button onClick={() => setCities(cities.filter((x) => x !== c))} className="hover:text-blue-900">✕</button>
              </span>
            ))}
            {counties.map((co) => (
              <span key={co} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-xs font-medium">
                {co}
                <button onClick={() => setCounties(counties.filter((x) => x !== co))} className="hover:text-violet-900">✕</button>
              </span>
            ))}
            {builders.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                {b}
                <button onClick={() => setBuilders(builders.filter((x) => x !== b))} className="hover:text-amber-900">✕</button>
              </span>
            ))}
            {communities.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                {c}
                <button onClick={() => setCommunities(communities.filter((x) => x !== c))} className="hover:text-emerald-900">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="text-center text-stone-400 py-20">Loading analytics...</div>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

            {/* 1. Avg $/sqft */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Average Price / Sqft</h2>
              <p className="text-xs text-stone-400 mb-4">Active listings only</p>
              <ResponsiveContainer width="100%" height={ppsqftHeight}>
                <BarChart
                  data={data.avgPricePerSqftByCommunity.map((d) => ({ ...d, community: shortName(d.community) }))}
                  margin={{ top: 4, right: 16, bottom: 60, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis type="category" dataKey="community" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" />
                  <YAxis type="number" domain={[500, "auto"]} tickFormatter={(v) => `$${v.toLocaleString()}`} tick={{ fontSize: 11 }} width={62} />
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}/sqft`} />
                  <Bar dataKey="avgPricePerSqft" name="$/sqft" radius={[4, 4, 0, 0]}>
                    {data.avgPricePerSqftByCommunity.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 4. Average Price Over Time */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-1">Average Price Over Time</h2>
              <p className="text-xs text-stone-400 mb-3">Monthly avg of active listing prices</p>
              <ChartFilterBar
                filters={avgPriceFilters}
                onChange={setAvgPriceFilters}
                meta={meta}
                loading={avgPriceLoading}
              />
              {avgPriceLoading ? (
                <div className="h-[260px] flex items-center justify-center text-stone-400 text-sm">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={avgPriceMonthData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip formatter={(v) => formatPrice(Number(v))} />
                    <Line type="monotone" dataKey="avgPrice" name="Avg Price"
                      stroke="#6B9AC4" strokeWidth={2.5} dot={{ r: 4, fill: "#6B9AC4" }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 5. Sales Pace — weekly */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm lg:col-span-2">
              <h2 className="font-semibold text-stone-900 mb-1">Sales Pace</h2>
              <p className="text-xs text-stone-400 mb-3">Homes sold vs. new listings added per week</p>
              <ChartFilterBar
                filters={salesPaceFilters}
                onChange={setSalesPaceFilters}
                meta={meta}
                loading={salesPaceLoading}
              />
              {salesPaceLoading ? (
                <div className="h-[260px] flex items-center justify-center text-stone-400 text-sm">Loading…</div>
              ) : salesPaceWeekData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={salesPaceWeekData} margin={{ top: 4, right: 16, bottom: 24, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10 }}
                      angle={-45}
                      textAnchor="end"
                      interval={Math.max(0, Math.floor(salesPaceWeekData.length / 12) - 1)}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                    <Tooltip
                      formatter={(v, name) =>
                        name === "sold" ? [`${v} sold`, "Sold"] : [`${v} added`, "New Listings"]
                      }
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      iconSize={8}
                      formatter={(v) => (
                        <span className="text-xs text-stone-500">{v === "sold" ? "Sold / Removed" : "New Listings"}</span>
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="newListings"
                      name="newListings"
                      fill="#DBEAFE"
                      stroke="#93C5FD"
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Bar dataKey="sold" name="sold" fill="#C46060" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-stone-400 text-sm">
                  No weekly sales data yet.
                </div>
              )}
            </div>

            {/* 6. Sales Trend (monthly) */}
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm lg:col-span-2">
              <h2 className="font-semibold text-stone-900 mb-1">Sales Trend</h2>
              <p className="text-xs text-stone-400 mb-3">Listings marked sold or removed from builder site per month</p>
              <ChartFilterBar
                filters={salesTrendFilters}
                onChange={setSalesTrendFilters}
                meta={meta}
                loading={salesTrendLoading}
              />
              {salesTrendLoading ? (
                <div className="h-[220px] flex items-center justify-center text-stone-400 text-sm">Loading…</div>
              ) : salesTrendMonthData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={salesTrendMonthData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Sold" radius={[4, 4, 0, 0]}>
                      {salesTrendMonthData.map((_, i) => (
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
      </ContentGate>
    </div>
  )
}
