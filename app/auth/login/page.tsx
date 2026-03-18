"use client"

import { Suspense, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorParam = searchParams.get("error")

  const [tab, setTab] = useState<"login" | "signup">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    errorParam ? { type: "error", text: errorParam } : null
  )

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setMessage({ type: "error", text: error.message })
    } else {
      router.push("/dashboard")
      router.refresh()
    }
    setLoading(false)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setMessage({ type: "error", text: error.message })
    } else {
      setMessage({
        type: "success",
        text: "Check your email for a confirmation link to complete your signup.",
      })
    }
    setLoading(false)
  }

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => { setTab("login"); setMessage(null) }}
          className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
            tab === "login"
              ? "text-blue-600 border-b-2 border-blue-600 bg-white"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Sign In
        </button>
        <button
          onClick={() => { setTab("signup"); setMessage(null) }}
          className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
            tab === "signup"
              ? "text-blue-600 border-b-2 border-blue-600 bg-white"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Create Account
        </button>
      </div>

      <div className="p-8">
        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.type === "error"
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-green-50 text-green-700 border border-green-200"
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={tab === "login" ? handleLogin : handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === "signup" ? "At least 6 characters" : "••••••••"}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors mt-2"
          >
            {loading
              ? tab === "login"
                ? "Signing in…"
                : "Creating account…"
              : tab === "login"
              ? "Sign In"
              : "Create Account"}
          </button>
        </form>

        {tab === "login" && (
          <p className="mt-4 text-center text-xs text-gray-500">
            Don&apos;t have an account?{" "}
            <button
              onClick={() => { setTab("signup"); setMessage(null) }}
              className="text-blue-600 hover:underline font-medium"
            >
              Sign up free
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-start justify-center bg-gray-50 px-4 pt-16">
      <div className="w-full max-w-md relative">
        {/* Login card */}
        <div className="relative z-10">
          <div className="mb-6 text-center">
            <Link href="/">
              <img src="/logo.png" alt="NewKey.us" className="h-28 w-auto mx-auto mix-blend-multiply" />
            </Link>
          </div>
          <Suspense fallback={<div className="h-64 bg-white rounded-2xl border border-gray-200 animate-pulse" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
