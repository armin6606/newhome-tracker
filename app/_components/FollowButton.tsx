"use client"

import { useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { useUser } from "@/lib/hooks/useUser"
import { useRouter } from "next/navigation"

interface Props {
  communityId: number
  initialFollowing?: boolean
}

export function FollowButton({ communityId, initialFollowing = false }: Props) {
  const { user } = useUser()
  const router = useRouter()
  const [following, setFollowing] = useState(initialFollowing)
  const [loading, setLoading] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      router.push("/auth/login")
      return
    }

    setLoading(true)
    const method = following ? "DELETE" : "POST"
    await fetch("/api/follows", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ communityId }),
    })
    setFollowing(!following)
    setLoading(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
        following
          ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
          : "bg-white border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700"
      }`}
      title={following ? "Unfollow community" : "Follow for new listing alerts"}
    >
      {following ? (
        <>
          <Bell className="h-3.5 w-3.5 fill-current" />
          Following
        </>
      ) : (
        <>
          <Bell className="h-3.5 w-3.5" />
          Follow
        </>
      )}
    </button>
  )
}
