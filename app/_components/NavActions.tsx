"use client"

import Link from "next/link"
import { useUser } from "@/lib/hooks/useUser"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { LayoutDashboard, LogIn, LogOut } from "lucide-react"

export function NavActions() {
  const { user, loading } = useUser()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  if (loading) {
    return <div className="h-8 w-24 bg-gray-700 rounded animate-pulse" />
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-700 transition-colors"
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </Link>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-700 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    )
  }

  return (
    <Link
      href="/auth/login"
      className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg transition-colors"
    >
      <LogIn className="h-4 w-4" />
      Sign In
    </Link>
  )
}
