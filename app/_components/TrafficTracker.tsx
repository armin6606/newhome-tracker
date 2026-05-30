"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const SESSION_KEY = "newkey-traffic-session"

function getSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing

    const generated = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, generated)
    return generated
  } catch {
    return null
  }
}

export function TrafficTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin") || pathname.startsWith("/api")) return

    const qs = window.location.search.replace(/^\?/, "")
    const path = qs ? `${pathname}?${qs}` : pathname
    const sessionId = getSessionId()

    const body = JSON.stringify({
      path,
      sessionId,
      referrer: document.referrer || null,
    })

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))
      return
    }

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined)
  }, [pathname])

  return null
}
