"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { useAuth } from "./useAuth"

/**
 * FilterGate wraps the homepage filter bar.
 * Authenticated users interact normally.
 * Unauthenticated users see the filters visually but clicking any
 * filter control triggers a signup modal instead.
 */
export function FilterGate({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuth()
  const [showModal, setShowModal] = useState(false)

  const handleInteraction = useCallback(
    (e: React.MouseEvent | React.FocusEvent) => {
      if (isAuthenticated === false) {
        e.preventDefault()
        e.stopPropagation()
        setShowModal(true)
      }
    },
    [isAuthenticated]
  )

  // While auth state is loading, render children normally (no gate)
  if (isAuthenticated === null || isAuthenticated === true) {
    return <>{children}</>
  }

  return (
    <>
      {/* Wrap filters — intercept click and focus events */}
      <div
        onClick={handleInteraction}
        onFocusCapture={handleInteraction}
        className="relative cursor-pointer"
      >
        {/* Render filters visually but pointer-events-none so native inputs don't activate */}
        <div className="pointer-events-none select-none opacity-75">
          {children}
        </div>
        {/* Invisible overlay to capture clicks */}
        <div className="absolute inset-0 z-10" />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center relative">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-stone-400 hover:text-stone-600 text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
            <div className="mb-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L12 21l-1.006-.503A2.25 2.25 0 019.75 18.484v-2.927a2.25 2.25 0 00-.659-1.591L3.659 8.534A2.25 2.25 0 013 6.943V5.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-stone-900 mb-2">
                Sign up for free to unlock filters and track new homes
              </h2>
              <p className="text-stone-500 text-sm">
                Create a free account to filter listings, save favorites, and get alerts on new homes.
              </p>
            </div>
            <Link
              href="/auth/login"
              className="inline-block w-full py-3 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-lg transition-all text-sm"
            >
              Sign Up Free
            </Link>
            <p className="mt-3 text-xs text-stone-400">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-blue-600 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      )}
    </>
  )
}
