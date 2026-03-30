"use client"

import { ContentGate } from "@/app/_components/ContentGate"

const COLUMNS = ["Community", "City", "Builder", "Type", "Plan", "Bed / Bath", "Floors", "Sqft", "Est. Opening"]

export default function UpcomingPage() {
  return (
    <div>
      {/* Hero */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 mb-6" style={{ minHeight: 160 }}>
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1600&q=80')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-stone-900/80 via-stone-800/70 to-stone-900/50" />
        <div className="relative px-4 sm:px-6 lg:px-8 py-10">
          <p className="text-amber-400 text-xs font-semibold uppercase tracking-widest mb-1.5">Coming Soon</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2">
            Upcoming <span className="text-amber-300">Communities</span>
          </h1>
          <p className="text-stone-300 text-sm max-w-xl">
            Future lots and floor plans not yet released — track what&apos;s coming before it hits the market.
          </p>
        </div>
      </div>

      <ContentGate>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {COLUMNS.map((col) => (
                  <th key={col} className="px-4 py-3 whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-20 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
                      <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-500 font-medium">Upcoming Communities data coming soon</p>
                    <p className="text-gray-400 text-xs max-w-xs">
                      Floor plans, bed/bath counts, and opening dates will appear here once the data feed is connected.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ContentGate>
    </div>
  )
}
