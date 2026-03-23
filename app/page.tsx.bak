"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { formatPrice, formatNumber, cleanCommunityName } from "@/lib/utils"
import { HeartButton } from "@/app/_components/HeartButton"
import { FilterGate } from "@/app/_components/FilterGate"
import { getBuilderColor } from "@/lib/builder-colors"

type Listing = {
  id: number
  communityId: number
  address: string | null
  lotNumber: string | null
  floorPlan: string | null
  sqft: number | null
  beds: number | null
  baths: number | null
  floors: number | null
  propertyType: string | null
  currentPrice: number | null
  pricePerSqft: number | null
  hoaFees: number | null
  taxes: number | null
  moveInDate: string | null
  schools: string | null
  status: string
  firstDetected: string
  community: { name: string; city: string; state: string; builder: { name: string } }
}

function isReady(moveInDate: string | null) {
  const lower = moveInDate?.toLowerCase() ?? ""
  return lower.includes("ready") && !lower.match(/\d{1,2}\/\d{4}/)
}

/** Strip "Quick Move-In " prefix, return just date or status text */
function formatMoveIn(moveInDate: string | null): string {
  if (!moveInDate) return "—"
  return moveInDate.replace(/^quick\s+move[-\s]?in\s*/i, "").trim() || moveInDate
}

/** Estimated monthly payment: 20% down, 30-year fixed, P+I + HOA */
function estimatedMonthly(price: number | null, annualRate: number, hoaFees: number | null): number | null {
  if (!price || !annualRate) return null
  const principal = price * 0.8 // 20% down
  const r = annualRate / 100 / 12
  const n = 360
  const pi = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
  return Math.round(pi + (hoaFees ?? 0))
}

function formatLot(lot: string | null) {
  if (!lot) return "—"
  const stripped = lot.replace(/home site\s*/i, "").trim()
  if (!stripped) return "—"
  const num = parseInt(stripped, 10)
  return isNaN(num) ? stripped : num.toString()
}

function getPpsqThresholds(listings: Listing[]): [number, number, number, number] {
  const vals = listings
    .map((l) => l.pricePerSqft)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b)
  if (vals.length < 5) return [450, 600, 750, 900]
  const p = (pct: number) => vals[Math.floor((vals.length - 1) * pct)]
  return [p(0.2), p(0.4), p(0.6), p(0.8)]
}

function ppsqColor(ppsq: number | null, thresholds: [number, number, number, number]): string {
  if (!ppsq) return "text-stone-400"
  const [t1, t2, t3, t4] = thresholds
  if (ppsq >= t4) return "font-semibold text-red-600"
  if (ppsq >= t3) return "font-semibold text-orange-500"
  if (ppsq >= t2) return "font-semibold text-amber-500"
  if (ppsq >= t1) return "font-semibold text-lime-600"
  return "font-semibold text-emerald-600"
}

const EXTERIOR_STYLES = /\s+(contemporary|mid[-\s]century|modern farmhouse|modern|tuscan|craftsman|traditional|colonial|mediterranean|spanish|ranch|prairie|tudor|victorian|farmhouse|cape cod|coastal|transitional|industrial|scandinavian|rustic|urban|shingle|french country|english cottage|italianate|art deco|southwest|adobe|bungalow|georgian|federal|neoclassical|plantation|queenslander|revival|heritage|classic|luxury|new american|american|santa barbara|hacienda|pueblo|craftsman revival)(\s+|$)/gi

function cleanPlanName(name: string | null): string {
  if (!name) return "—"
  return name.replace(EXTERIOR_STYLES, " ").trim() || name.trim()
}


function SchoolRatingBadge({ name, state }: { name: string; state: string }) {
  const [info, setInfo] = useState<{ rating: number | null; url: string } | null>(null)
  useEffect(() => {
    fetch(`/api/schools?name=${encodeURIComponent(name)}&state=${encodeURIComponent(state)}`)
      .then((r) => r.json())
      .then((d) => setInfo({ rating: d.rating ?? null, url: d.url }))
      .catch(() => setInfo({ rating: null, url: `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(name)}&state=${state}` }))
  }, [name, state])

  const ratingColor = info?.rating
    ? info.rating >= 8 ? "bg-emerald-500" : info.rating >= 5 ? "bg-amber-500" : "bg-red-500"
    : "bg-stone-300"

  const href = info?.url || `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(name)}&state=${state}`

  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1.5 hover:underline group w-full">
      <span className={`w-5 h-5 rounded-full ${ratingColor} text-white text-[9px] font-bold flex items-center justify-center flex-none shrink-0`}>
        {info === null ? "…" : info.rating ?? "?"}
      </span>
      <span className="text-xs text-stone-600 group-hover:text-blue-600 leading-tight">{name}</span>
    </a>
  )
}

function NewsletterCard() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [msg, setMsg] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setStatus("loading")
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus("success")
        setMsg(data.message)
        setEmail("")
      } else {
        setStatus("error")
        setMsg(data.error || "Something went wrong")
      }
    } catch {
      setStatus("error")
      setMsg("Something went wrong")
    }
  }

  return (
    <div className="group rounded-xl overflow-hidden border border-stone-200 shadow-sm hover:shadow-md transition-all bg-white">
      <div className="relative h-44 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1596526131083-e8c633c948d2?auto=format&fit=crop&w=800&q=80')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/75 via-stone-900/20 to-transparent" />
        <div className="absolute bottom-0 left-0 px-4 py-3">
          <p className="text-white font-bold text-xl leading-tight drop-shadow">Weekly Newsletter</p>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-amber-600 text-xs font-semibold mb-1">Free weekly updates</p>
        {status === "success" ? (
          <p className="text-emerald-600 text-sm font-medium">{msg}</p>
        ) : (
          <>
            <p className="text-stone-500 text-sm leading-snug mb-2">
              Get new listings, price drops, and market insights delivered to your inbox every week.
            </p>
            <form onSubmit={handleSubmit} className="flex gap-1.5">
              <input
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setStatus("idle") }}
                className="flex-1 min-w-0 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                required
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {status === "loading" ? "..." : "Subscribe"}
              </button>
            </form>
            {status === "error" && <p className="text-red-500 text-xs mt-1">{msg}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export default function HomePage() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set())
  const [sortBy, setSortBy] = useState("currentPrice")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [interestRate, setInterestRate] = useState<number | null>(null)

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
  const [typeFilter, setTypeFilter] = useState("")
  const [builderFilter, setBuilderFilter] = useState("")

  // Table horizontal scroll
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 2)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    el.addEventListener("scroll", update, { passive: true })
    const t = setTimeout(update, 400)
    return () => { el.removeEventListener("scroll", update); clearTimeout(t) }
  }, [listings])

  function scrollTable(dir: number) {
    tableScrollRef.current?.scrollBy({ left: dir * 350, behavior: "smooth" })
  }

  // Compare
  const [compareIds, setCompareIds] = useState<number[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [compareRate, setCompareRate] = useState<number>(6.85)
  const [compareDown, setCompareDown] = useState<number>(20)
  const [compareTerm, setCompareTerm] = useState<number>(30)
  const [compareLoanType, setCompareLoanType] = useState<"fixed" | "arm">("fixed")

  function toggleCompare(id: number) {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev
    )
  }

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

  // Load user's favorited IDs for heart button initial state
  useEffect(() => {
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((ids: number[]) => { if (Array.isArray(ids)) setFavoriteIds(new Set(ids)) })
      .catch(() => {})
  }, [])

  // Fetch current 30-year mortgage rate once on mount
  useEffect(() => {
    fetch("/api/mortgage-rate")
      .then((r) => r.json())
      .then((d) => { if (d.rate) { setInterestRate(d.rate); setCompareRate(d.rate) } })
      .catch(() => setInterestRate(6.85))
  }, [])

  // Deduplicate within the same community only (same communityId + same address)
  const deduped = listings.filter((l, idx, arr) => {
    if (!l.address) return idx === arr.findIndex((x) => x.communityId === l.communityId && !x.address)
    const key = `${l.communityId}__${l.address.toLowerCase().trim()}`
    return arr.findIndex((x) => `${x.communityId}__${(x.address ?? "").toLowerCase().trim()}` === key) === idx
  })

  // Builders and cities that have at least one listing (for dropdowns)
  const buildersWithListings = Array.from(
    new Set(listings.map((l) => l.community.builder.name))
  ).sort()
  const citiesWithListings = Array.from(
    new Set(listings.map((l) => l.community.city.trim().replace(/\b\w/g, c => c.toUpperCase())))
  ).sort()

  const displayed = deduped.filter((l) => {
    if (citySearch && l.community.city.toLowerCase() !== citySearch.toLowerCase()) return false
    if (moveInOnly && !isReady(l.moveInDate)) return false
    if (typeFilter && l.propertyType !== typeFilter) return false
    if (builderFilter && l.community.builder.name !== builderFilter) return false
    return true
  })

  // Dynamic $/sqft color thresholds based on current displayed listings
  const ppsqThresholds = getPpsqThresholds(displayed)

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
    setTypeFilter("")
    setBuilderFilter("")
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
                { label: "30-Yr Rate", value: interestRate ? `${interestRate.toFixed(2)}%` : "—" },
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

      {/* Quick Nav Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            href: "/communities",
            title: "Communities",
            desc: "Browse all active builder communities, track sales velocity, and compare inventory levels side by side.",
            photo: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80",
            stat: communities > 0 ? `${communities} active communities` : null,
          },
          {
            href: "/incentives",
            title: "Incentives & Offers",
            desc: "Closing cost credits, rate buydowns, flex cash, and premium upgrade packages from top builders.",
            photo: "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=800&q=80",
            stat: "Updated daily",
          },
          {
            href: "/analytics",
            title: "Market Analytics",
            desc: "Price trends, avg $/sqft by community, sales velocity charts, and full market intelligence.",
            photo: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80",
            stat: activeListings.length > 0 ? `${activeListings.length} homes tracked` : null,
          },
        ].map(({ href, title, desc, photo, stat }) => (
          <Link key={href} href={href} className="group rounded-xl overflow-hidden border border-stone-200 shadow-sm hover:shadow-md transition-all bg-white">
            <div className="relative h-44 overflow-hidden">
              <div
                className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                style={{ backgroundImage: `url('${photo}')` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-900/75 via-stone-900/20 to-transparent" />
              <div className="absolute bottom-0 left-0 px-4 py-3">
                <p className="text-white font-bold text-xl leading-tight drop-shadow">{title}</p>
              </div>
            </div>
            <div className="px-4 py-3">
              {stat && <p className="text-amber-600 text-xs font-semibold mb-1">{stat}</p>}
              <p className="text-stone-500 text-sm leading-snug">{desc}</p>
            </div>
          </Link>
        ))}
        {/* Newsletter Signup Card */}
        <NewsletterCard />
      </div>

      {/* Filter Bar */}
      <FilterGate>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm px-4 py-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* City */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">City</label>
            <select value={citySearch} onChange={(e) => setCitySearch(e.target.value)} className={`${selectCls} w-40`}>
              <option value="">All Cities</option>
              {citiesWithListings.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Builder */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Builder</label>
            <select value={builderFilter} onChange={(e) => setBuilderFilter(e.target.value)} className={`${selectCls} w-40`}>
              <option value="">All Builders</option>
              {buildersWithListings.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
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

          {/* Type */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Type</label>
            <div className="flex gap-1">
              {(["", "Detached", "Attached"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => setTypeFilter(val)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === val ? "bg-amber-500 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                >
                  {val === "" ? "Any" : val}
                </button>
              ))}
            </div>
          </div>

          {/* Reset */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] invisible">x</label>
            <button onClick={resetFilters} className="h-[34px] px-3 rounded-lg text-xs text-stone-400 hover:text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors">
              ↺ Reset
            </button>
          </div>

        </div>
        <div className="mt-2 text-sm text-stone-400 text-right">
          {loading ? "Loading..." : `${displayed.length} listing${displayed.length !== 1 ? "s" : ""}`}
        </div>
      </div>
      </FilterGate>

      {/* Mobile listing cards (hidden on md+) */}
      <div className="md:hidden flex flex-col gap-3">
        {loading ? (
          <div className="text-center text-stone-400 py-12">Loading listings...</div>
        ) : displayed.length === 0 ? (
          <div className="text-center text-stone-400 py-12">No listings found.</div>
        ) : (
          displayed.map((l) => (
            <Link key={l.id} href={`/listings/${l.id}`} className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm hover:shadow-md transition-shadow block">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900 text-sm truncate">{l.address}</p>
                  <p className="text-xs text-stone-500 truncate" title={cleanCommunityName(l.community.name)}>{cleanCommunityName(l.community.name)} · {l.community.city}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-stone-900 text-sm">{formatPrice(l.currentPrice)}</p>
                  {l.pricePerSqft && (
                    <p className={`text-xs ${ppsqColor(l.pricePerSqft, ppsqThresholds)}`}>${l.pricePerSqft.toLocaleString()}/sqft</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 mb-2">
                {l.beds != null && <span>{l.beds} bd</span>}
                {l.baths != null && <span>{l.baths} ba</span>}
                {l.sqft && <span>{formatNumber(l.sqft)} sqft</span>}
                {l.floors && <span>{l.floors}fl</span>}
                {l.propertyType && (
                  <span className={`px-1.5 py-0.5 rounded font-medium ${l.propertyType === "Attached" ? "bg-purple-100 text-purple-700" : "bg-sky-100 text-sky-700"}`}>
                    {l.propertyType}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold" style={{ color: getBuilderColor(l.community.builder.name) }}>{l.community.builder.name}</span>
                {isReady(l.moveInDate) ? (
                  <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">Ready</span>
                ) : (
                  <span className="text-stone-400">{formatMoveIn(l.moveInDate)}</span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Table (desktop only) */}
      <div className="hidden md:block bg-white rounded-xl border border-stone-200 shadow-sm">
        <div ref={tableScrollRef} className="overflow-x-auto overflow-y-auto rounded-xl max-h-[75vh]">
          <table className="min-w-max w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-stone-50 border-b border-stone-200">
                {[
                  { label: "Compare", field: null },
                  { label: "Community", field: null },
                  { label: "City", field: null },
                  { label: "Builder", field: null },
                  { label: "Type", field: null },
                  { label: "Address", field: "address" },
                  { label: "Lot", field: null },
                  { label: "Plan", field: null },
                  { label: "Bed/Bath", field: "beds" },
                  { label: "Floors", field: "floors" },
                  { label: "Sq Ft", field: "sqft" },
                  { label: "Price", field: "currentPrice" },
                  { label: "$/Sqft", field: "pricePerSqft" },
                  { label: "HOA", field: null },
                  { label: "Taxes", field: null },
                  { label: "Move-In", field: null },
                ].map(({ label, field }) => (
                  <th
                    key={label}
                    className={`px-4 py-3 text-center text-sm font-semibold uppercase tracking-wide whitespace-nowrap ${label === "Compare" ? "text-amber-600" : "text-stone-500"} ${field ? "cursor-pointer hover:text-stone-700" : ""}`}
                    onClick={field ? () => handleSort(field) : undefined}
                  >
                    {label}{field && <SortIcon field={field} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <tr><td colSpan={16} className="px-4 py-12 text-center text-stone-400">Loading listings...</td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={16} className="px-4 py-12 text-center text-stone-400">No listings found.</td></tr>
              ) : (
                displayed.map((l, idx) => (
                  <tr key={l.id} className={`hover:bg-amber-50/70 transition-colors ${compareIds.includes(l.id) ? "bg-amber-50" : idx % 2 === 0 ? "bg-white" : "bg-stone-50"}`}>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(l.id)}
                        onChange={() => toggleCompare(l.id)}
                        disabled={!compareIds.includes(l.id) && compareIds.length >= 3}
                        className="w-4 h-4 accent-amber-500 cursor-pointer disabled:opacity-30"
                        title={!compareIds.includes(l.id) && compareIds.length >= 3 ? "Max 3 homes" : "Compare"}
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[160px] text-center">
                      <div className="relative group/comm">
                        <span className="block truncate text-stone-800 font-medium">{cleanCommunityName(l.community.name)}</span>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-stone-800 text-white text-xs rounded whitespace-nowrap shadow-lg z-50 hidden group-hover/comm:block pointer-events-none">
                          {cleanCommunityName(l.community.name)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-center">{l.community.city}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className="font-semibold" style={{ color: getBuilderColor(l.community.builder.name) }}>
                        {l.community.builder.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      {l.propertyType ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${l.propertyType === "Attached" ? "bg-purple-100 text-purple-700" : "bg-sky-100 text-sky-700"}`}>
                          {l.propertyType}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        <HeartButton listingId={l.id} initialFavorited={favoriteIds.has(l.id)} size="sm" />
                        <Link href={`/listings/${l.id}`} className="font-medium text-stone-900 hover:text-amber-700 hover:underline">
                          {l.address}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-center">{formatLot(l.lotNumber)}</td>
                    <td className="px-4 py-3 text-stone-500 max-w-[130px] text-center">
                      <span className="block truncate">{cleanPlanName(l.floorPlan)}</span>
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap text-center">
                      {l.beds != null && l.baths != null ? `${l.beds}/${l.baths}` : (l.beds ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap text-center">
                      {l.floors ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap text-center">{formatNumber(l.sqft)}</td>
                    <td className="px-4 py-3 font-semibold text-stone-900 whitespace-nowrap text-center">{formatPrice(l.currentPrice)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={ppsqColor(l.pricePerSqft, ppsqThresholds)}>
                        {l.pricePerSqft ? `$${l.pricePerSqft.toLocaleString()}` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap text-center">
                      {l.hoaFees ? `$${l.hoaFees.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap text-center">
                      {l.taxes ? `$${l.taxes.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      {isReady(l.moveInDate) ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wide">Ready</span>
                      ) : (
                        <span className="text-stone-600">{formatMoveIn(l.moveInDate)}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating table scroll arrows (desktop only) */}
      {(canScrollLeft || canScrollRight) && (
        <div className="hidden md:flex fixed bottom-6 right-6 z-40 gap-2">
          <button
            onClick={() => scrollTable(-1)}
            disabled={!canScrollLeft}
            className="w-9 h-9 rounded-full bg-white border border-stone-200 shadow-lg flex items-center justify-center text-stone-600 hover:bg-stone-50 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            title="Scroll table left"
          >‹</button>
          <button
            onClick={() => scrollTable(1)}
            disabled={!canScrollRight}
            className="w-9 h-9 rounded-full bg-white border border-stone-200 shadow-lg flex items-center justify-center text-stone-600 hover:bg-stone-50 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            title="Scroll table right"
          >›</button>
        </div>
      )}

      {/* Compare bar */}
      {compareIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 shadow-lg px-6 py-3 flex items-center gap-4 z-50">
          <span className="text-sm font-semibold text-stone-700">{compareIds.length}/3 homes selected</span>
          <div className="flex gap-2 flex-1">
            {compareIds.map((id) => {
              const l = displayed.find((x) => x.id === id)
              return l ? (
                <span key={id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1 text-xs text-stone-700">
                  {l.address}
                  <button onClick={() => toggleCompare(id)} className="text-stone-400 hover:text-stone-600 ml-1">✕</button>
                </span>
              ) : null
            })}
          </div>
          <button
            onClick={() => setShowCompare(true)}
            disabled={compareIds.length < 2}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Compare {compareIds.length} Homes
          </button>
          <button onClick={() => setCompareIds([])} className="text-stone-400 hover:text-stone-600 text-sm">Clear</button>
        </div>
      )}

      {/* Compare modal */}
      {showCompare && (() => {
        const cmpListings = compareIds.map((id) => displayed.find((x) => x.id === id)).filter(Boolean) as Listing[]

        function rankAmong(vals: (number | null | undefined)[]): ('high' | 'low' | 'mid' | 'na')[] {
          const nums = vals.filter((v): v is number => v != null)
          if (nums.length < 2) return vals.map(() => 'na' as const)
          const max = Math.max(...nums), min = Math.min(...nums)
          if (max === min) return vals.map(() => 'mid' as const)
          return vals.map((v) => v == null ? 'na' : v === max ? 'high' : v === min ? 'low' : 'mid')
        }
        // Returns bg fill class: higherIsBetter=true → high=green bg, low=red bg
        function rankBg(rank: 'high' | 'low' | 'mid' | 'na', higherIsBetter: boolean): string {
          if (rank === 'na' || rank === 'mid') return ''
          const good = higherIsBetter ? rank === 'high' : rank === 'low'
          return good ? 'bg-emerald-200' : 'bg-red-200'
        }

        const priceRanks   = rankAmong(cmpListings.map((l) => l.currentPrice))
        const minPrice     = Math.min(...cmpListings.map((l) => l.currentPrice ?? Infinity))
        const monthlyPayments = cmpListings.map((l) => {
          if (!l.currentPrice || !compareRate) return null
          const principal = l.currentPrice * (1 - compareDown / 100)
          const r = compareRate / 100 / 12
          const n = compareTerm * 12
          const pi = r === 0 ? principal / n : principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
          return Math.round(pi + (l.hoaFees ?? 0))
        })
        const monthlyRanks = rankAmong(monthlyPayments)
        const hoaRanks     = rankAmong(cmpListings.map((l) => l.hoaFees))
        const taxRanks     = rankAmong(cmpListings.map((l) => l.taxes))
        const sqftRanks    = rankAmong(cmpListings.map((l) => l.sqft))
        const ppsqRanks    = rankAmong(cmpListings.map((l) => l.pricePerSqft))

        function builderCls(name: string) {
          return { className: "font-semibold", style: { color: getBuilderColor(name) } }
        }

        const labelCls = "px-3 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide w-32 border-r border-stone-300"
        const cellCls  = "px-3 py-2.5 border-l border-stone-300 text-center text-stone-800"

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCompare(false)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="relative flex items-center justify-between px-6 py-5 overflow-hidden">
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80')" }} />
                <div className="absolute inset-0 bg-gradient-to-r from-stone-900/85 via-stone-800/75 to-stone-900/60" />
                <div className="relative">
                  <p className="text-amber-400 text-[10px] font-semibold uppercase tracking-widest mb-0.5">New Construction Intelligence</p>
                  <h2 className="text-lg font-bold text-white">Side-by-Side Comparison</h2>
                  <p className="text-stone-300 text-xs mt-0.5">{cmpListings.length} homes selected</p>
                </div>
                <button onClick={() => setShowCompare(false)} className="relative text-white/70 hover:text-white text-2xl leading-none transition-colors">✕</button>
              </div>
              {/* Address sub-header */}
              <div className="grid border-b border-stone-300 bg-stone-50" style={{ gridTemplateColumns: `8rem repeat(${cmpListings.length}, 1fr)` }}>
                <div className="px-3 py-3" />
                {cmpListings.map((l, i) => (
                  <div key={l.id} className="px-3 py-3 border-l border-stone-300 text-center">
                    <p className="font-bold text-stone-900 text-sm">{l.address}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{cleanCommunityName(l.community.name)}</p>
                    {l.currentPrice && (
                      <p className={`font-bold text-sm mt-1 ${priceRanks[i] === 'low' ? 'text-emerald-700' : priceRanks[i] === 'high' ? 'text-red-700' : 'text-stone-800'}`}>
                        {formatPrice(l.currentPrice)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {/* Rows */}
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <tbody>
                    {/* Price Diff */}
                    <tr className="bg-white">
                      <td className={labelCls}>Price Diff</td>
                      {cmpListings.map((l, i) => {
                        const diff = l.currentPrice != null ? l.currentPrice - minPrice : null
                        const isLowest = diff === 0
                        return (
                          <td key={l.id} className={`${cellCls} font-bold ${isLowest ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                            {diff === null ? "—" : diff === 0 ? "$0" : `+${formatPrice(diff)}`}
                          </td>
                        )
                      })}
                    </tr>
                    {/* Est. Monthly */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>Est. Monthly</td>
                      {cmpListings.map((l, i) => {
                        const mp = monthlyPayments[i]
                        return (
                          <td key={l.id} className={`${cellCls} font-semibold ${rankBg(monthlyRanks[i], false)}`}>
                            {mp ? `$${mp.toLocaleString()}` : "—"}
                          </td>
                        )
                      })}
                    </tr>
                    {/* Builder */}
                    <tr className="bg-white">
                      <td className={labelCls}>Builder</td>
                      {cmpListings.map((l) => {
                        const bc = builderCls(l.community.builder.name)
                        return <td key={l.id} className={`${cellCls} ${bc.className}`} style={bc.style}>{l.community.builder.name}</td>
                      })}
                    </tr>
                    {/* Type */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>Type</td>
                      {cmpListings.map((l) => (
                        <td key={l.id} className={cellCls}>{l.propertyType || "—"}</td>
                      ))}
                    </tr>
                    {/* Plan */}
                    <tr className="bg-white">
                      <td className={labelCls}>Plan</td>
                      {cmpListings.map((l) => (
                        <td key={l.id} className={cellCls}>{cleanPlanName(l.floorPlan)}</td>
                      ))}
                    </tr>
                    {/* Beds/Baths */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>Beds / Baths</td>
                      {cmpListings.map((l) => (
                        <td key={l.id} className={cellCls}>
                          {l.beds != null && l.baths != null ? `${l.beds} bd / ${l.baths} ba` : "—"}
                        </td>
                      ))}
                    </tr>
                    {/* Floors */}
                    <tr className="bg-white">
                      <td className={labelCls}>Floors</td>
                      {cmpListings.map((l) => (
                        <td key={l.id} className={cellCls}>{l.floors ?? "—"}</td>
                      ))}
                    </tr>
                    {/* Sq Ft */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>Sq Ft</td>
                      {cmpListings.map((l, i) => (
                        <td key={l.id} className={`${cellCls} font-semibold ${rankBg(sqftRanks[i], true)}`}>
                          {formatNumber(l.sqft)}
                        </td>
                      ))}
                    </tr>
                    {/* $/Sqft */}
                    <tr className="bg-white">
                      <td className={labelCls}>$ / Sqft</td>
                      {cmpListings.map((l, i) => (
                        <td key={l.id} className={`${cellCls} font-semibold ${rankBg(ppsqRanks[i], false)}`}>
                          {l.pricePerSqft ? `$${l.pricePerSqft.toLocaleString()}` : "—"}
                        </td>
                      ))}
                    </tr>
                    {/* HOA */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>HOA</td>
                      {cmpListings.map((l, i) => (
                        <td key={l.id} className={`${cellCls} font-semibold ${rankBg(hoaRanks[i], false)}`}>
                          {l.hoaFees ? `$${l.hoaFees.toLocaleString()}` : "—"}
                        </td>
                      ))}
                    </tr>
                    {/* Taxes */}
                    <tr className="bg-white">
                      <td className={labelCls}>Taxes</td>
                      {cmpListings.map((l, i) => (
                        <td key={l.id} className={`${cellCls} font-semibold ${rankBg(taxRanks[i], false)}`}>
                          {l.taxes ? `$${l.taxes.toLocaleString()}` : "—"}
                        </td>
                      ))}
                    </tr>
                    {/* Move-In */}
                    <tr className="bg-stone-100">
                      <td className={labelCls}>Move-In</td>
                      {cmpListings.map((l) => (
                        <td key={l.id} className={cellCls}>{formatMoveIn(l.moveInDate)}</td>
                      ))}
                    </tr>
                    {/* Schools */}
                    <tr className="bg-white">
                      <td className={`${labelCls} align-top pt-3`}>Schools</td>
                      {cmpListings.map((l) => {
                        const schoolNames = l.schools
                          ? l.schools.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
                          : []
                        return (
                          <td key={l.id} className={`${cellCls} align-top`}>
                            {schoolNames.length === 0 ? (
                              <span className="text-stone-400 text-xs">—</span>
                            ) : (
                              <div className="flex flex-col gap-1.5 text-left">
                                {schoolNames.map((name) => (
                                  <SchoolRatingBadge
                                    key={name}
                                    name={name}
                                    state={l.community.state || "CA"}
                                  />
                                ))}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                    {/* GreatSchools disclosure */}
                    <tr>
                      <td colSpan={cmpListings.length + 1} className="px-3 py-2 text-[10px] text-stone-400 text-right border-t border-stone-100">
                        School ratings provided by{" "}
                        <a href="https://www.greatschools.org" target="_blank" rel="noopener noreferrer"
                          className="underline hover:text-stone-600">GreatSchools.org</a>
                        {" "}· Ratings are on a 1–10 scale. Click any school to view full profile.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Footer — loan settings */}
              <div className="relative px-5 py-3 overflow-hidden flex items-center gap-5 flex-wrap">
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80')" }} />
                <div className="absolute inset-0 bg-amber-600/85" />
                <div className="relative flex items-center gap-5 flex-wrap w-full">
                <span className="text-white font-semibold text-xs uppercase tracking-widest whitespace-nowrap">Loan Settings</span>
                {/* Loan type */}
                <div className="flex items-center gap-1.5">
                  <label className="text-amber-100 text-xs whitespace-nowrap">Type</label>
                  <div className="flex gap-1">
                    {(["fixed", "arm"] as const).map((t) => (
                      <button key={t} onClick={() => setCompareLoanType(t)}
                        className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${compareLoanType === t ? "bg-white text-amber-600" : "bg-white/20 text-white hover:bg-white/30"}`}>
                        {t === "fixed" ? "Fixed" : "ARM"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Rate */}
                <div className="flex items-center gap-1.5">
                  <label className="text-amber-100 text-xs whitespace-nowrap">Rate</label>
                  <input
                    type="number" step="0.01" min="1" max="20" value={compareRate}
                    onChange={(e) => setCompareRate(parseFloat(e.target.value) || 6.85)}
                    className="w-16 rounded px-2 py-1 text-sm text-center bg-white/20 text-white placeholder-amber-200 border border-white/30 focus:outline-none focus:bg-white/30"
                  />
                  <span className="text-amber-100 text-xs">%</span>
                </div>
                {/* Down payment */}
                <div className="flex items-center gap-1.5">
                  <label className="text-amber-100 text-xs whitespace-nowrap">Down</label>
                  <input
                    type="number" step="1" min="0" max="100" value={compareDown}
                    onChange={(e) => setCompareDown(parseFloat(e.target.value) || 20)}
                    className="w-14 rounded px-2 py-1 text-sm text-center bg-white/20 text-white placeholder-amber-200 border border-white/30 focus:outline-none focus:bg-white/30"
                  />
                  <span className="text-amber-100 text-xs">%</span>
                </div>
                {/* Loan term — hidden for ARM (ARM rates are quoted for initial period separately) */}
                {compareLoanType === "fixed" && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-amber-100 text-xs whitespace-nowrap">Term</label>
                    <div className="flex gap-0.5">
                      {[15, 20, 30].map((yr) => (
                        <button key={yr} onClick={() => setCompareTerm(yr)}
                          className={`px-1.5 py-1 rounded text-xs font-semibold transition-colors ${compareTerm === yr ? "bg-white text-amber-600" : "bg-white/20 text-white hover:bg-white/30"}`}>
                          {yr}yr
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {compareLoanType === "arm" && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-amber-100 text-xs whitespace-nowrap">Init. Period</label>
                    <div className="flex gap-0.5">
                      {[5, 7, 10].map((yr) => (
                        <button key={yr} onClick={() => setCompareTerm(yr)}
                          className={`px-1.5 py-1 rounded text-xs font-semibold transition-colors ${compareTerm === yr ? "bg-white text-amber-600" : "bg-white/20 text-white hover:bg-white/30"}`}>
                          {yr}/1
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => { setShowCompare(false); setCompareIds([]) }} className="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors">Clear & Close</button>
                  <button onClick={() => setShowCompare(false)} className="px-4 py-1.5 bg-white text-amber-600 rounded-lg text-xs font-bold hover:bg-amber-50 transition-colors">Done</button>
                </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
