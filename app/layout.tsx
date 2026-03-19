import type { Metadata } from "next"
import { Nunito } from "next/font/google"
import "./globals.css"
import Link from "next/link"
import { NavActions } from "@/app/_components/NavActions"
import { MobileNav } from "@/app/_components/MobileNav"

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800"] })

export const metadata: Metadata = {
  title: "NewKey.us — New Construction Homes",
  description: "Track new construction homes, price history, and sales velocity in Irvine",
  icons: {
    icon: "/logo.png",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${nunito.variable} font-[family-name:var(--font-nunito)] antialiased bg-stone-50 min-h-screen overflow-x-hidden`}>
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-20">
              <Link href="/" className="flex items-center">
                <img src="/logo.png" alt="NewKey.us" className="h-20 w-auto" />
              </Link>
              {/* Desktop nav */}
              <div className="hidden md:flex items-center gap-6 text-sm font-semibold text-gray-600">
                <Link href="/" className="hover:text-blue-700 transition-colors">Home</Link>
                <Link href="/communities" className="hover:text-blue-700 transition-colors">Communities</Link>
                <Link href="/incentives" className="hover:text-blue-700 transition-colors">Incentives</Link>
                <Link href="/analytics" className="hover:text-blue-700 transition-colors">Analytics</Link>
                <NavActions />
              </div>
              {/* Mobile hamburger */}
              <MobileNav />
            </div>
          </div>
        </nav>
        <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
