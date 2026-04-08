"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/lib/hooks/useUser"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Heart, Bell, TrendingDown, TrendingUp, Minus, ExternalLink } from "lucide-react"
import { HeartButton } from "@/app/_components/HeartButton"
import { FollowButton } from "@/app/_components/FollowButton"

interface FavoriteListing {
  id: number
  address: string
  community: string
  builder: string
  floorPlan: string | null
  beds: number | null
  baths: number | null
  sqft: number | null
  currentPrice: number | null
  pricePerSqft: number | null
  hoaFees: number | null
  taxes: string | null
  propertyType: string | null
  moveInDate: string | null
  status: string
  daysListed: number
  sourceUrl: string | null
  priceHistory: { price: number; changeType: string; detectedAt: string }[]
}

interface FollowedCommunity {
  id: number
  name: string
  builder: string
  city: string
  activeCount: number
  minPrice: number | null
  maxPrice: number | null
  url: string
}

function fmt(n: number | null) {
  if (!n) return "—"
  return "$" + n.toLocaleString()
}

function PriceChange({ history }: { history: FavoriteListing["priceHistory"] }) {
  if (history.length < 2) return null
  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  const diff = last.price - prev.price
  if (diff === 0) return null

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        diff < 0 ? "text-green-600" : "text-red-600"
      }`}
    >
      {diff < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {diff < 0 ? "-" : "+"}${Math.abs(diff).toLocaleString()}
    </span>
  )
}

export default function DashboardPage() {
  const { user, loading } = useUser()
  const router = useRouter()

  const [favorites, setFavorites] = useState<FavoriteListing[]>([])
  const [follows, setFollows] = useState<FollowedCommunity[]>([])
  const [fetching, setFetching] = useState(true)
  const [tab, setTab] = useState<"favorites" | "follows">("favorites")

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login")
    }
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    Promise.all([
      fetch("/api/dashboard/favorites").then((r) => r.json()),
      fetch("/api/dashboard/follows").then((r) => r.json()),
    ]).then(([favs, fols]) => {
      setFavorites(Array.isArray(favs) ? favs : [])
      setFollows(Array.isArray(fols) ? fols : [])
      setFetching(false)
    })
  }, [user])

  if (loading || fetching) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-8" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">{user.email}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab("favorites")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === "favorites"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Heart className="h-4 w-4" />
          Saved Homes
          {favorites.length > 0 && (
            <span className="bg-red-100 text-red-600 text-xs px-1.5 py-0.5 rounded-full">
              {favorites.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("follows")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === "follows"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Bell className="h-4 w-4" />
          Followed Communities
          {follows.length > 0 && (
            <span className="bg-blue-100 text-blue-600 text-xs px-1.5 py-0.5 rounded-full">
              {follows.length}
            </span>
          )}
        </button>
      </div>

      {/* Favorites Tab */}
      {tab === "favorites" && (
        <div>
          {favorites.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Heart className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No saved homes yet</p>
              <p className="text-sm mt-1">
                Click the heart icon on any listing to save it here.
              </p>
              <Link
                href="/"
                className="mt-4 inline-block text-sm text-blue-600 hover:underline"
              >
                Browse listings →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map((l) => (
                <div
                  key={l.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/listings/${l.id}`}
                          className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                        >
                          {l.address}
                        </Link>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            l.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {l.status === "active" ? "Active" : "Sold/Removed"}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {l.community} · {l.builder}
                        {l.floorPlan && ` · ${l.floorPlan}`}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
                        {l.beds && <span>{l.beds} bd</span>}
                        {l.baths && <span>{l.baths} ba</span>}
                        {l.sqft && <span>{l.sqft.toLocaleString()} sqft</span>}
                        {l.hoaFees && <span>HOA {fmt(l.hoaFees)}/mo</span>}
                        {l.moveInDate && <span>Move-in: {l.moveInDate}</span>}
                        <span className="text-gray-400">{l.daysListed}d listed</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-lg font-bold text-gray-900">
                          {fmt(l.currentPrice)}
                        </div>
                        <PriceChange history={l.priceHistory} />
                      </div>
                      <div className="flex items-center gap-1">
                        {l.sourceUrl && (
                          <a
                            href={l.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                            title="View on builder site"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <HeartButton listingId={l.id} initialFavorited={true} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Follows Tab */}
      {tab === "follows" && (
        <div>
          {follows.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Bell className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">Not following any communities</p>
              <p className="text-sm mt-1">
                Follow communities to get email alerts when new homes are added.
              </p>
              <Link
                href="/communities"
                className="mt-4 inline-block text-sm text-blue-600 hover:underline"
              >
                Browse communities →
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {follows.map((c) => (
                <div
                  key={c.id}
                  className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/communities`}
                        className="font-semibold text-gray-900 hover:text-blue-600 transition-colors leading-tight block"
                      >
                        {c.name}
                      </Link>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {c.builder} · {c.city}
                      </div>
                    </div>
                    <FollowButton communityId={c.id} initialFollowing={true} />
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <div>
                      <span className="font-semibold text-gray-900">{c.activeCount}</span>
                      <span className="text-gray-500 ml-1">active</span>
                    </div>
                    {c.minPrice && (
                      <div className="text-gray-600">
                        {fmt(c.minPrice)}
                        {c.maxPrice && c.maxPrice !== c.minPrice && ` – ${fmt(c.maxPrice)}`}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
