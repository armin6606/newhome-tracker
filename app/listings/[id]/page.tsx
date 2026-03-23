"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { formatPrice, formatNumber, daysAgo, cleanCommunityName } from "@/lib/utils"
import { getBuilderColor } from "@/lib/builder-colors"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { HeartButton } from "@/app/_components/HeartButton"

type PriceHistory = {
  id: number
  price: number
  changeType: string
  detectedAt: string
}

type Listing = {
  id: number
  address: string
  lotNumber: string | null
  floorPlan: string | null
  sqft: number | null
  beds: number | null
  baths: number | null
  garages: number | null
  floors: number | null
  propertyType: string | null
  currentPrice: number | null
  pricePerSqft: number | null
  hoaFees: number | null
  taxes: number | null
  moveInDate: string | null
  schools: string | null
  incentives: string | null
  incentivesUrl: string | null
  status: string
  sourceUrl: string | null
  firstDetected: string
  soldAt: string | null
  community: { name: string; city: string; state: string; builder: { name: string } }
  priceHistory: PriceHistory[]
}

const CHANGE_COLORS: Record<string, string> = {
  initial: "text-gray-600",
  increase: "text-red-600",
  decrease: "text-green-600",
}
const CHANGE_LABELS: Record<string, string> = {
  initial: "Initial price",
  increase: "Price increase",
  decrease: "Price reduction",
}

function SchoolBadge({ name, state }: { name: string; state: string }) {
  const [info, setInfo] = useState<{ rating: number | null; url: string } | null>(null)
  useEffect(() => {
    const fallback = `https://www.greatschools.org/search/search.page?q=${encodeURIComponent(name)}&state=${state}`
    fetch(`/api/schools?name=${encodeURIComponent(name)}&state=${encodeURIComponent(state)}`)
      .then((r) => r.json())
      .then((d) => setInfo({ rating: d.rating ?? null, url: d.url || fallback }))
      .catch(() => setInfo({ rating: null, url: fallback }))
  }, [name, state])
  const ratingColor = info?.rating
    ? info.rating >= 8 ? "bg-emerald-500" : info.rating >= 5 ? "bg-amber-500" : "bg-red-500"
    : "bg-stone-300"
  return (
    <a href={info?.url || `https://www.greatschools.org`} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 hover:underline group">
      <span className={`w-6 h-6 rounded-full ${ratingColor} text-white text-[10px] font-bold flex items-center justify-center flex-none`}>
        {info === null ? "…" : (info.rating ?? "?")}
      </span>
      <span className="text-sm text-stone-700 group-hover:text-blue-600">{name}</span>
    </a>
  )
}

function PaymentCalculator({ price, hoaFees, taxes }: { price: number | null; hoaFees: number | null; taxes: number | null }) {
  const [rate, setRate] = useState("6.75")
  const [down, setDown] = useState("20")
  const [term, setTerm] = useState<30 | 15>(30)
  const [loanType, setLoanType] = useState<"fixed" | "arm">("fixed")

  if (!price) return null

  const downAmt = price * (parseFloat(down) / 100)
  const principal = price - downAmt
  const r = parseFloat(rate) / 100 / 12
  const n = term * 12
  const pi = r > 0 ? principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : principal / n
  const monthlyHoa = hoaFees ?? 0
  // taxes stored as rate × 100 (e.g. 189 = 1.89%) — calculate monthly dollar amount
  const monthlyTax = taxes && price ? Math.round(price * (taxes / 100) / 100 / 12) : 0
  const total = Math.round(pi + monthlyHoa + monthlyTax)

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
      <h2 className="font-semibold text-stone-900 mb-4 text-base">Monthly Payment Estimate</h2>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide block mb-1">Interest Rate</label>
          <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
            <input type="number" step="0.05" min="2" max="15" value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm focus:outline-none" />
            <span className="px-2 text-stone-400 text-sm bg-stone-50 border-l border-stone-200">%</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide block mb-1">Down Payment</label>
          <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
            <input type="number" step="1" min="3" max="50" value={down}
              onChange={(e) => setDown(e.target.value)}
              className="w-full px-3 py-1.5 text-sm focus:outline-none" />
            <span className="px-2 text-stone-400 text-sm bg-stone-50 border-l border-stone-200">%</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide block mb-1">Loan Term</label>
          <div className="flex gap-1">
            {([30, 15] as const).map((t) => (
              <button key={t} onClick={() => setTerm(t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${term === t ? "bg-amber-500 text-white border-amber-500" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
                {t} yr
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide block mb-1">Loan Type</label>
          <div className="flex gap-1">
            {(["fixed", "arm"] as const).map((t) => (
              <button key={t} onClick={() => setLoanType(t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${loanType === t ? "bg-amber-500 text-white border-amber-500" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
                {t === "fixed" ? "Fixed" : "ARM"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Down amount */}
      <p className="text-xs text-stone-400 mb-4">Down: {formatPrice(Math.round(downAmt))} · Loan: {formatPrice(Math.round(principal))}</p>

      {/* Breakdown */}
      <div className="space-y-2 text-sm border-t border-stone-100 pt-3">
        <div className="flex justify-between text-stone-600">
          <span>Principal & Interest</span>
          <span className="font-medium">{formatPrice(Math.round(pi))}/mo</span>
        </div>
        {monthlyHoa > 0 && (
          <div className="flex justify-between text-stone-600">
            <span>HOA</span>
            <span className="font-medium">{formatPrice(monthlyHoa)}/mo</span>
          </div>
        )}
        {monthlyTax > 0 && (
          <div className="flex justify-between text-stone-600">
            <span>Property Tax (est.)</span>
            <span className="font-medium">{formatPrice(monthlyTax)}/mo</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-stone-900 text-base pt-2 border-t border-stone-200">
          <span>Est. Total / Month</span>
          <span className="text-amber-600">{formatPrice(total)}</span>
        </div>
      </div>
      <p className="text-[10px] text-stone-400 mt-3">Estimate only. Does not include insurance, PMI, or closing costs. Consult a licensed lender.</p>
    </div>
  )
}

// Ad placeholder cards
function RealtorAd() {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center text-base font-bold text-blue-700">A</div>
        <div>
          <p className="font-semibold text-sm text-stone-900 leading-tight">Alex Martinez</p>
          <p className="text-stone-400 text-xs">DRE #01234567</p>
        </div>
      </div>
      <p className="text-[10px] text-blue-600 mb-1 font-semibold uppercase tracking-wide">New Construction Specialist</p>
      <p className="text-xs text-stone-500 leading-snug mb-3">Specializing in new construction homes in Orange County. Free buyer representation.</p>
      <div className="space-y-1.5">
        <a href="tel:9491234567" className="flex items-center gap-2 text-xs text-stone-600 hover:text-blue-700 transition-colors">
          <span>📞</span> (949) 123-4567
        </a>
        <a href="mailto:alex@example.com" className="flex items-center gap-2 text-xs text-stone-600 hover:text-blue-700 transition-colors">
          <span>✉</span> alex@example.com
        </a>
      </div>
      <div className="mt-3 pt-3 border-t border-blue-100">
        <p className="text-[10px] text-blue-500 uppercase tracking-wide font-semibold">Keller Williams Realty</p>
      </div>
    </div>
  )
}

function LoanOfficerAd() {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center text-base font-bold text-amber-700">S</div>
        <div>
          <p className="font-semibold text-sm text-stone-900 leading-tight">Sarah Chen</p>
          <p className="text-stone-400 text-xs">NMLS #0987654</p>
        </div>
      </div>
      <p className="text-[10px] text-amber-600 mb-1 font-semibold uppercase tracking-wide">Senior Loan Officer</p>
      <p className="text-xs text-stone-500 leading-snug mb-3">Jumbo, FHA, VA & Conv. loans. Pre-approval in 24 hours. Builder incentive financing expertise.</p>
      <div className="space-y-1.5">
        <a href="tel:9492345678" className="flex items-center gap-2 text-xs text-stone-600 hover:text-amber-700 transition-colors">
          <span>📞</span> (949) 234-5678
        </a>
        <a href="mailto:sarah@example.com" className="flex items-center gap-2 text-xs text-stone-600 hover:text-amber-700 transition-colors">
          <span>✉</span> sarah@example.com
        </a>
      </div>
      <div className="mt-3 pt-3 border-t border-amber-100">
        <p className="text-[10px] text-amber-500 uppercase tracking-wide font-semibold">CrossCountry Mortgage</p>
      </div>
    </div>
  )
}

export default function ListingDetailPage() {
  const { id } = useParams()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [favorited, setFavorited] = useState(false)

  useEffect(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => r.json())
      .then((data) => { setListing(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((ids: number[]) => { if (Array.isArray(ids)) setFavorited(ids.includes(Number(id))) })
      .catch(() => {})
  }, [id])

  if (loading) return <div className="text-stone-400 py-20 text-center">Loading...</div>
  if (!listing) return <div className="text-stone-400 py-20 text-center">Listing not found.</div>

  const daysListed = daysAgo(listing.firstDetected)
  const totalPriceChange =
    listing.priceHistory.length > 1
      ? listing.priceHistory[listing.priceHistory.length - 1].price - listing.priceHistory[0].price
      : 0

  const chartData = listing.priceHistory.map((ph) => ({
    date: new Date(ph.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    price: ph.price,
  }))

  const schoolNames = listing.schools
    ? listing.schools.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    : []

  const builderColor = getBuilderColor(listing.community.builder.name)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-blue-600 hover:underline text-sm">← Back to listings</Link>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Main content ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Header card */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
              <div>
                <h1 className="text-2xl font-bold text-stone-900">
                  {/^Lot\s+\d+$/i.test((listing.address ?? "").trim()) ? "—" : listing.address}
                </h1>
                <p className="text-stone-500 mt-0.5 text-sm">
                  {cleanCommunityName(listing.community.name)} ·{" "}
                  <span className="font-semibold" style={{ color: builderColor }}>{listing.community.builder.name}</span>
                  {" "}· {listing.community.city}, {listing.community.state}
                </p>
              </div>
              <div className="text-right flex items-start gap-2">
                <HeartButton listingId={listing.id} initialFavorited={favorited} />
                <div>
                  <div className="text-3xl font-bold text-stone-900">{formatPrice(listing.currentPrice)}</div>
                  {totalPriceChange !== 0 && (
                    <div className={`text-sm font-medium mt-0.5 ${totalPriceChange < 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {totalPriceChange > 0 ? "+" : ""}{formatPrice(totalPriceChange)} total change
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Key stats grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 pt-4 border-t border-stone-100">
              {[
                { label: "Bedrooms",    value: listing.beds ?? "—" },
                { label: "Bathrooms",   value: listing.baths ?? "—" },
                { label: "Square Feet", value: formatNumber(listing.sqft) },
                { label: "Floors",      value: listing.floors ?? "—" },
                { label: "Type",        value: listing.propertyType || "—" },
                { label: "Garage",      value: listing.garages ? `${listing.garages} car` : "—" },
                { label: "Floor Plan",  value: listing.floorPlan || "—" },
                { label: "Lot #",       value: listing.lotNumber || "—" },
                { label: "Price/sqft",  value: listing.pricePerSqft ? `$${listing.pricePerSqft}` : "—" },
                { label: "HOA/mo",      value: formatPrice(listing.hoaFees) },
                { label: "Tax Rate",    value: listing.taxes ? `${(listing.taxes / 100).toFixed(2)}%` : "—" },
                { label: "Move-In",     value: listing.moveInDate ? listing.moveInDate.replace(/^quick\s+move[-\s]?in\s*/i, "").trim() || listing.moveInDate : "—" },
                { label: "Status",      value: listing.status === "removed" ? "Sold/Removed" : "Active" },
                { label: "Days Listed", value: `${daysListed}d` },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col">
                  <span className="text-xs text-stone-400 font-medium">{label}</span>
                  <span className="text-sm font-semibold text-stone-900 mt-0.5">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Schools */}
          {schoolNames.length > 0 && (
            <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
              <h2 className="font-semibold text-stone-900 mb-3 text-base">Nearby Schools</h2>
              <div className="space-y-2.5">
                {schoolNames.map((name) => (
                  <SchoolBadge key={name} name={name} state={listing.community.state || "CA"} />
                ))}
              </div>
              <p className="text-[10px] text-stone-400 mt-3">
                Ratings by <a href="https://www.greatschools.org" target="_blank" rel="noopener noreferrer" className="underline">GreatSchools.org</a> on a 1–10 scale.
              </p>
            </div>
          )}

          {/* Incentives */}
          {listing.incentives && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-5 shadow-sm">
              <h2 className="font-semibold text-amber-800 mb-2 text-base flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-none" />
                Current Builder Incentive
              </h2>
              <p className="text-sm text-amber-900 leading-relaxed">{listing.incentives}</p>
              {listing.incentivesUrl && (
                <a
                  href={listing.incentivesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-amber-700 underline hover:text-amber-900"
                >
                  View full offer details on builder website →
                </a>
              )}
            </div>
          )}

          {/* Payment calculator */}
          <PaymentCalculator price={listing.currentPrice} hoaFees={listing.hoaFees} taxes={listing.taxes} />

          {/* Price history */}
          <div className="bg-white rounded-xl border border-stone-200 p-5 shadow-sm">
            <h2 className="font-semibold text-stone-900 mb-4 text-base">Price History</h2>
            {listing.priceHistory.length === 0 ? (
              <p className="text-stone-400 text-sm">No price history recorded yet.</p>
            ) : (
              <>
                {listing.priceHistory.length > 1 && (
                  <div className="mb-5 h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={55} />
                        <Tooltip formatter={(v) => formatPrice(Number(v))} />
                        <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="space-y-2">
                  {[...listing.priceHistory].reverse().map((ph, i, arr) => {
                    const prev = arr[i + 1]
                    const delta = prev ? ph.price - prev.price : 0
                    return (
                      <div key={ph.id} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-stone-500">
                            {new Date(ph.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className={`text-xs font-medium ${CHANGE_COLORS[ph.changeType]}`}>
                            {CHANGE_LABELS[ph.changeType] || ph.changeType}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-stone-900 text-sm">{formatPrice(ph.price)}</span>
                          {delta !== 0 && (
                            <span className={`text-xs ml-2 ${delta < 0 ? "text-emerald-600" : "text-red-600"}`}>
                              ({delta > 0 ? "+" : ""}{formatPrice(delta)})
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {listing.soldAt && (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-stone-500">
                        {new Date(listing.soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="text-xs font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">Sold / Removed</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>{/* end main */}

        {/* ── Right sidebar: ads ── */}
        <div className="w-56 flex-none space-y-4 sticky top-20">
          <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest text-center">Featured Professionals</p>
          <RealtorAd />
          <LoanOfficerAd />
          <p className="text-[10px] text-stone-300 text-center">Advertise here · contact@newkey.us</p>
        </div>
      </div>{/* end flex */}
    </div>
  )
}
