import type { Metadata } from "next"
import { Geist } from "next/font/google"
import "./globals.css"
import Link from "next/link"

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "NewHome Tracker — New Construction Homes",
  description: "Track new construction homes, price history, and sales velocity in Irvine",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased bg-gray-50 min-h-screen`}>
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <Link href="/" className="font-bold text-lg text-blue-700 tracking-tight">
                NewHome Tracker
              </Link>
              <div className="flex items-center gap-6 text-sm font-medium text-gray-600">
                <Link href="/" className="hover:text-blue-700 transition-colors">Listings</Link>
                <Link href="/communities" className="hover:text-blue-700 transition-colors">Communities</Link>
                <Link href="/analytics" className="hover:text-blue-700 transition-colors">Analytics</Link>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
