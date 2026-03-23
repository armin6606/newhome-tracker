"use client"

import { useState } from "react"
import { Heart } from "lucide-react"
import { useUser } from "@/lib/hooks/useUser"
import { useRouter } from "next/navigation"

interface Props {
  listingId: number
  initialFavorited?: boolean
  size?: "sm" | "md"
}

export function HeartButton({ listingId, initialFavorited = false, size = "md" }: Props) {
  const { user } = useUser()
  const router = useRouter()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)

  const iconClass = size === "sm" ? "h-4 w-4" : "h-5 w-5"
  const btnClass = size === "sm" ? "p-1" : "p-1.5"

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      router.push("/auth/login")
      return
    }

    setLoading(true)
    const method = favorited ? "DELETE" : "POST"
    await fetch("/api/favorites", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
    })
    setFavorited(!favorited)
    setLoading(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={favorited ? "Remove from favorites" : "Save to favorites"}
      className={`${btnClass} rounded-full transition-all hover:scale-110 disabled:opacity-50`}
    >
      <Heart
        className={`${iconClass} transition-colors ${
          favorited ? "fill-red-500 stroke-red-500" : "stroke-gray-400 hover:stroke-red-400"
        }`}
      />
    </button>
  )
}
