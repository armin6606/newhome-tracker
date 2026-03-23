"use client"

import { useEffect, useState } from "react"
import { formatPrice, cleanCommunityName } from "@/lib/utils"
import { getBuilderColor } from "@/lib/builder-colors"
import { FollowButton } from "@/app/_components/FollowButton"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts"
import { ContentGate } from "@/app/_components/ContentGate"

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
  future: number
  salesPerMonth: number
  avgDaysOnMarket: number | null
  minPrice: number | null
  maxPrice: number | null
  salesByWeek: { week: string; sold: number }[]
}


export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [followIds, setFollowIds] = useState<Set<number>>(new Set())
  const [cityFilter, setCityFilter] = useState("")
  const [builderFilter, setBuilderFilter] = useState("")
  const [communitySearch, setCommunitySearch] = useState("")

  useEffect(() => {
    fetch("/api/communities")
      .then((r) => r.json())
      .then((data) => { setCommunities(data); setLoading(false) })
  }, [])

  useEffect(() => {
    fetch("/api/follows")
      .then((r) => r.json())
      .then((ids: number[]) => { if (Array.isArray(ids)) setFollowIds(new Set(ids)) })
      .catch(() => {})
  }, [])

  const citiesWithCommunities = Array.from(new Set(communities.map((c) => c.city).filter(Boolean))).sort()
  const buildersWithCommunities = Array.from(new Set(communities.map((c) => c.builderName).filter(Boolean))).sort()

  const displayed = communities.filter((c) => {
    if (cityFilter && c.city !== cityFilter) return false
    if (builderFilter && c.builderName !== builderFilter) return false
    if (communitySearch && !cleanCommunityName(c.name).toLowerCase().includes(communitySearch.toLowerCase())) return false
    return true
  })

  const selectCls = "border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"

  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 160 }}>
        <div className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1600&q=80')" }} />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Builder Communities</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Active <span className="text-amber-300">Communities</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Sales velocity, inventory levels, and pricing by new construction community.
          </p>
          {!loading && (
            <div className="mt-4 flex gap-6">
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{displayed.length}</span>
                <span className="text-stone-400 text-xs mt-0.5">Communities</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">
                  {displayed.reduce((s, c) => s + c.active, 0)}
                </span>
                <span className="text-stone-400 text-xs mt-0.5">For Sale</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">
                  {displayed.reduce((s, c) => s + c.sold, 0)}
                </span>
                <span className="text-stone-400 text-xs mt-0.5">Sold</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ContentGate>
      {/* Filters */}
      {!loading && communities.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Community</label>
            <input
              type="text"
              placeholder="Search communities..."
              value={communitySearch}
              onChange={(e) => setCommunitySearch(e.target.value)}
              className={`${selectCls} w-48`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">City</label>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className={`${selectCls} w-44`}>
              <option value="">All Cities</option>
              {citiesWithCommunities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Builder</label>
            <select value={builderFilter} onChange={(e) => setBuilderFilter(e.target.value)} className={`${selectCls} w-44`}>
              <option value="">All Builders</option>
              {buildersWithCommunities.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          {(cityFilter || builderFilter || communitySearch) && (
            <button
              onClick={() => { setCityFilter(""); setBuilderFilter(""); setCommunitySearch("") }}
              className="text-xs text-gray-400 hover:text-gray-600 underline self-end pb-1.5"
            >
              Reset
            </button>
          )}
          {(cityFilter || builderFilter || communitySearch) && (
            <span className="text-xs text-gray-400 self-end pb-1.5">
              {displayed.length} of {communities.length} communities
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-20">Loading...</div>
      ) : communities.length === 0 ? (
        <div className="text-center text-gray-400 py-20">No communities yet. Run the scraper first.</div>
      ) : displayed.length === 0 ? (
        <div className="text-center text-gray-400 py-20">No communities match the selected filters.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-1 gap-2">
                <h2 className="font-semibold text-gray-900 text-base leading-snug">{cleanCommunityName(c.name)}</h2>
                <div className="flex items-center gap-2 shrink-0">
                  <FollowButton communityId={c.id} initialFollowing={followIds.has(c.id)} />
                  <a href={c.url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 text-xs hover:underline">
                    View →
                  </a>
                </div>
              </div>
              <p className="text-xs mb-4">
                <span className="font-semibold" style={{ color: getBuilderColor(c.builderName) }}>{c.builderName}</span>
                <span className="text-gray-400"> · {c.city}, {c.state}</span>
              </p>

              {/* Inventory stats */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center bg-green-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-green-600">{c.active}</div>
                  <div className="text-xs text-green-700 font-medium">For Sale</div>
                </div>
                <div className="text-center bg-red-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-red-600">{c.sold}</div>
                  <div className="text-xs text-red-700 font-medium">Sold</div>
                </div>
                <div className="text-center bg-blue-50 rounded-lg p-2">
                  <div className="text-xl font-bold text-blue-400">{c.future}</div>
                  <div className="text-xs text-blue-400 font-medium">Future</div>
                </div>
              </div>
              <div className="text-center text-xs text-gray-400 mb-3">
                Total on map: <span className="font-semibold text-gray-600">{c.totalReleased}</span>
              </div>

              {/* Pie chart */}
              {(c.active > 0 || c.sold > 0) && (
                <div className="mb-3">
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: "For Sale", value: c.active },
                          { name: "Sold", value: c.sold },
                          ...(c.future > 0 ? [{ name: "Future", value: c.future }] : []),
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={30}
                        outerRadius={48}
                        dataKey="value"
                        paddingAngle={2}
                      >
                        <Cell fill="#16a34a" />
                        <Cell fill="#dc2626" />
                        {c.future > 0 && <Cell fill="#93c5fd" />}
                      </Pie>
                      <Tooltip
                        contentStyle={{ fontSize: 11, padding: "2px 8px", borderRadius: 6 }}
                        formatter={(v, name) => [`${v}`, name]}
                      />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Weekly sales bar chart */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span className="font-medium">
                    {c.salesByWeek.length <= 1
                      ? "Sales (this week)"
                      : `Sales (past ${c.salesByWeek.length} weeks)`}
                  </span>
                  <span className="font-semibold text-gray-800">{c.salesPerMonth}/mo pace</span>
                </div>
                {c.salesByWeek.some((w) => w.sold > 0) ? (
                  <ResponsiveContainer width="100%" height={80}>
                    <BarChart data={c.salesByWeek} margin={{ top: 2, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} axisLine={false}
                        interval={Math.max(0, Math.floor(c.salesByWeek.length / 4) - 1)} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={{ stroke: "#d1d5db" }} width={28} />
                      <Tooltip
                        cursor={{ fill: "#f3f4f6" }}
                        contentStyle={{ fontSize: 11, padding: "2px 8px", borderRadius: 6 }}
                        formatter={(v) => [`${v} sold`, "Sales"]}
                      />
                      <Bar dataKey="sold" radius={[3, 3, 0, 0]} maxBarSize={16}>
                        {c.salesByWeek.map((entry, i) => (
                          <Cell key={i} fill={entry.sold > 0 ? getBuilderColor(c.builderName) : "#e5e7eb"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[70px] flex items-center justify-center text-xs text-gray-300 bg-gray-50 rounded-lg">
                    No sales recorded yet
                  </div>
                )}
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
      </ContentGate>
    </div>
  )
}
