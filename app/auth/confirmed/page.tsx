import Link from "next/link"

export default function EmailConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-stone-100 via-white to-stone-50 px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white/60 backdrop-blur-md rounded-2xl shadow-xl border border-white/40 px-8 py-10">
          {/* Checkmark icon */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-stone-800 mb-2">
            Email Confirmed!
          </h1>
          <p className="text-stone-500 text-sm mb-8">
            Your email has been verified successfully. You're all set to start tracking new homes and builder incentives.
          </p>

          <Link
            href="/dashboard"
            className="inline-block w-full rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02]"
          >
            Continue to Dashboard
          </Link>

          <p className="mt-6 text-xs text-stone-400">
            Welcome to NewKey.us
          </p>
        </div>
      </div>
    </div>
  )
}
