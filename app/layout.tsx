import type { Metadata } from "next"
import { Nunito } from "next/font/google"
import "./globals.css"
import Link from "next/link"
import { NavActions } from "@/app/_components/NavActions"
import { GoogleAnalytics } from "@next/third-parties/google"
import { MobileNav } from "@/app/_components/MobileNav"

const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800"] })

const siteUrl = "https://www.newkey.us"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NewKey.us — New Construction Homes in Orange County",
    template: "%s | NewKey.us",
  },
  description:
    "Browse and track new construction homes in Orange County, CA. Compare prices, floor plans, move-in dates, and sales velocity across all major builders.",
  keywords: [
    "new construction homes Orange County",
    "new homes Irvine CA",
    "new build homes OC",
    "Toll Brothers Irvine",
    "Lennar new homes",
    "KB Home Orange County",
    "Taylor Morrison OC",
    "new home tracker",
  ],
  authors: [{ name: "NewKey.us" }],
  creator: "NewKey.us",
  publisher: "NewKey.us",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "NewKey.us",
    title: "NewKey.us — New Construction Homes in Orange County",
    description:
      "Browse and track new construction homes in Orange County, CA. Compare prices, floor plans, move-in dates, and sales velocity across all major builders.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "NewKey.us — New Construction Homes in Orange County",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NewKey.us — New Construction Homes in Orange County",
    description:
      "Browse and track new construction homes in Orange County, CA. Compare prices, floor plans, move-in dates, and sales velocity.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/favicon.ico",
    apple: "/logo.png",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "NewKey.us",
              url: "https://www.newkey.us",
              description:
                "Browse and track new construction homes in Orange County, CA.",
              publisher: {
                "@type": "Organization",
                name: "NewKey.us",
                url: "https://www.newkey.us",
                logo: {
                  "@type": "ImageObject",
                  url: "https://www.newkey.us/logo.png",
                },
                contactPoint: {
                  "@type": "ContactPoint",
                  email: "info@newkey.us",
                  contactType: "customer service",
                },
              },
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: "https://www.newkey.us/?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="NewKey.us" className="h-8 w-auto" />
                <span className="text-stone-400 text-sm">© {new Date().getFullYear()} NewKey.us</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-stone-500">
                <Link href="/privacy" className="hover:text-amber-600 transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-amber-600 transition-colors">Terms of Use</Link>
                <Link href="/accuracy" className="hover:text-amber-600 transition-colors">Data Accuracy Policy</Link>
                <a href="mailto:info@newkey.us" className="hover:text-amber-600 transition-colors">info@newkey.us</a>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-stone-400">
              All listing data is for informational purposes only and may not reflect current prices or availability.
              Always verify directly with the homebuilder.
            </p>
          </div>
        </footer>
      <GoogleAnalytics gaId="G-2NDP6KLSSY" />
      </body>
    </html>
  )
}
