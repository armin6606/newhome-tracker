"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { NavActions } from "./NavActions"

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/communities", label: "Communities" },
  { href: "/incentives", label: "Incentives" },
  { href: "/analytics", label: "Analytics" },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden p-2 -mr-2 text-gray-600 hover:text-gray-900 transition-colors"
        aria-label="Toggle menu"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {open && (
        <div className="md:hidden fixed top-20 left-0 right-0 bg-white border-b border-gray-200 shadow-xl z-50 px-5 py-5 flex flex-col gap-4">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="text-base font-semibold text-gray-700 hover:text-blue-700 transition-colors py-1"
            >
              {label}
            </Link>
          ))}
          <div className="pt-3 border-t border-gray-100">
            <NavActions />
          </div>
        </div>
      )}
    </>
  )
}
