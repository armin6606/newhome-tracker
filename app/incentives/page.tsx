"use client"

import { useState, useEffect, useCallback } from "react"
import { formatPrice, cleanCommunityName } from "@/lib/utils"
import { ContentGate } from "@/app/_components/ContentGate"

type CommunityEntry = {
  id: number
  name: string
  city: string
  state: string
  url: string
  activeCount: number
  minPrice: number | null
  maxPrice: number | null
}

type GroupedOffer = {
  offerText: string
  builder: string
  communities: CommunityEntry[]
}

function builderColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "text-[#1B4FA8]"
  if (name.toLowerCase().includes("toll")) return "text-[#C9940A]"
  if (name.toLowerCase().includes("kb")) return "text-red-600"
  if (name.toLowerCase().includes("tri pointe")) return "text-emerald-700"
  if (name.toLowerCase().includes("shea")) return "text-sky-600"
  if (name.toLowerCase().includes("pulte") || name.toLowerCase().includes("del webb")) return "text-violet-600"
  if (name.toLowerCase().includes("taylor")) return "text-orange-600"
  return "text-stone-600"
}

function builderBadgeColor(name: string): string {
  if (name.toLowerCase().includes("lennar")) return "bg-blue-50 text-blue-700 border-blue-200"
  if (name.toLowerCase().includes("toll")) return "bg-amber-50 text-amber-700 border-amber-200"
  if (name.toLowerCase().includes("kb")) return "bg-red-50 text-red-700 border-red-200"
  if (name.toLowerCase().includes("tri pointe")) return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (name.toLowerCase().includes("shea")) return "bg-sky-50 text-sky-700 border-sky-200"
  if (name.toLowerCase().includes("pulte") || name.toLowerCase().includes("del webb")) return "bg-violet-50 text-violet-700 border-violet-200"
  if (name.toLowerCase().includes("taylor")) return "bg-orange-50 text-orange-700 border-orange-200"
  return "bg-stone-100 text-stone-600 border-stone-200"
}

export default function IncentivesPage() {
  const [offers, setOffers] = useState<GroupedOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [citySearch, setCitySearch] = useState("")
  const [builderSearch, setBuilderSearch] = useState("")
  const [expandedOffers, setExpandedOffers] = useState<Set<number>>(new Set())

  const fetchIncentives = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (citySearch) params.set("city", citySearch)
    if (builderSearch) params.set("builder", builderSearch)
    const res = await fetch(`/api/incentives?${params}`)
    const data = await res.json()
    setOffers(data)
    // Collapsed by default
    setExpandedOffers(new Set())
    setLoading(false)
  }, [citySearch, builderSearch])

  useEffect(() => { fetchIncentives() }, [fetchIncentives])

  function toggleExpand(idx: number) {
    setExpandedOffers(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const inputCls = "border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
  const totalCommunities = offers.reduce((s, o) => s + o.communities.length, 0)
  const uniqueBuilders = new Set(offers.map((o) => o.builder)).size
  const totalListings = offers.reduce((s, o) => s + o.communities.reduce((cs, c) => cs + c.activeCount, 0), 0)

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
                <span className="text-amber-400 font-bold text-lg leading-none">{offers.length}</span>
                <span className="text-stone-400 text-xs mt-0.5">Unique Offers</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{totalCommunities}</span>
                <span className="text-stone-400 text-xs mt-0.5">Eligible Communities</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{uniqueBuilders}</span>
                <span className="text-stone-400 text-xs mt-0.5">Builders</span>
              </div>
              <div className="flex flex-col">
                <span className="text-amber-400 font-bold text-lg leading-none">{totalListings}</span>
                <span className="text-stone-400 text-xs mt-0.5">Active Listings</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ContentGate>
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
            {loading ? "Loading..." : `${offers.length} offer${offers.length !== 1 ? "s" : ""} across ${totalCommunities} communities`}
          </div>
        </div>
      </div>

      {/* Offers list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-12 text-center text-stone-400">
          Loading incentives...
        </div>
      ) : offers.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-12 text-center text-stone-400">
          Builder incentive data is being collected. Check back soon — or subscribe to the newsletter for updates.
        </div>
      ) : (
        <div className="space-y-4">
          {offers.map((offer, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
              {/* Offer header */}
              <button
                onClick={() => toggleExpand(idx)}
                className="w-full px-5 py-4 flex items-start gap-4 hover:bg-stone-50/50 transition-colors text-left"
              >
                <span className="mt-1 flex-none w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-semibold ${builderBadgeColor(offer.builder)}`}>
                      {offer.builder}
                    </span>
                    <span className="text-xs text-stone-400">
                      {offer.communities.length} communit{offer.communities.length === 1 ? "y" : "ies"}
                    </span>
                  </div>
                  <p className="text-stone-800 leading-snug text-sm whitespace-pre-line">
                    {offer.offerText}
                  </p>
                </div>
                <span className="mt-1 text-stone-400 text-sm flex-none">
                  {expandedOffers.has(idx) ? "▾" : "▸"}
                </span>
              </button>

              {/* Eligible communities */}
              {expandedOffers.has(idx) && (
                <div className="border-t border-stone-100">
                  <div className="px-5 py-2 bg-stone-50/50">
                    <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">
                      Eligible Communities
                    </span>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-stone-100">
                    {offer.communities.map((c, i) => (
                      <div key={c.id}
                        className={`px-4 py-2.5 flex items-center gap-3 hover:bg-amber-50/30 transition-colors ${Math.floor(i / 2) % 2 === 0 ? "bg-white" : "bg-stone-50/60"}`}>
                        <div className="flex-1 min-w-0">
                          <a href={c.url} target="_blank" rel="noopener noreferrer"
                            className={`font-semibold hover:underline text-sm ${builderColor(offer.builder)}`}>
                            {cleanCommunityName(c.name)}
                          </a>
                          <span className="text-xs text-stone-400 ml-2">{c.city}</span>
                          <span className="text-xs text-stone-400 ml-1.5">{c.activeCount} listing{c.activeCount !== 1 ? "s" : ""}</span>
                        </div>
                        <span className="text-sm text-stone-700 font-medium whitespace-nowrap">
                          {c.minPrice && c.maxPrice ? (
                            c.minPrice === c.maxPrice
                              ? formatPrice(c.minPrice)
                              : `${formatPrice(c.minPrice)} – ${formatPrice(c.maxPrice)}`
                          ) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-400 text-right">
        Incentives sourced directly from builder websites. Offers subject to change — verify with builder for current terms.
      </p>
      </ContentGate>
    </div>
  )
}
