"use client"

import Link from "next/link"
import { useAuth } from "./useAuth"

/**
 * ContentGate wraps page content below the hero on protected pages
 * (communities, incentives, analytics).
 *
 * Authenticated users see everything normally.
 * Unauthenticated users see a blurred/faded preview with a signup overlay.
 */
export function ContentGate({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuth()

  // While loading auth state, render children normally to avoid layout shift
  if (isAuthenticated === null || isAuthenticated === true) {
    return <>{children}</>
  }

  return (
    <div className="relative">
      {/* Blurred, non-interactive preview of the page content */}
      <div
        className="pointer-events-none select-none overflow-hidden"
        style={{ maxHeight: "60vh" }}
      >
        <div className="blur-[3px] opacity-60">
          {children}
        </div>
        {/* Fade-out gradient at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-gray-50 via-gray-50/95 to-transparent" />
      </div>

      {/* Signup overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-20">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full mx-4 p-10 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-5">
            <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-stone-900 mb-6">
            Sign Up for Free to Unlock All Features.
          </h2>
          <Link
            href="/auth/login"
            className="inline-block w-full max-w-xs py-3 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-lg transition-all text-sm"
          >
            Sign Up Free
          </Link>
          <p className="mt-4 text-xs text-stone-400">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
