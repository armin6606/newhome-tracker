"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/communities", label: "Active Communities" },
  { href: "/upcoming", label: "Upcoming" },
  { href: "/incentives", label: "Incentives" },
  { href: "/analytics", label: "Analytics" },
]

export function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname()

  if (mobile) {
    return (
      <>
        {LINKS.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`text-base font-semibold py-1 transition-colors ${
                active ? "text-amber-500" : "text-gray-700 hover:text-blue-700"
              }`}
            >
              {label}
            </Link>
          )
        })}
      </>
    )
  }

  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`transition-colors font-semibold text-sm pb-0.5 border-b-2 ${
              active
                ? "text-amber-500 border-amber-400"
                : "text-gray-600 border-transparent hover:text-blue-700 hover:border-blue-300"
            }`}
          >
            {label}
          </Link>
        )
      })}
    </>
  )
}
