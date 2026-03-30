"use client"

import { useState } from "react"
import { Menu, X } from "lucide-react"
import { NavActions } from "./NavActions"
import { NavLinks } from "./NavLinks"

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
        <div
          className="md:hidden fixed top-20 left-0 right-0 bg-white border-b border-gray-200 shadow-xl z-50 px-5 py-5 flex flex-col gap-4"
          onClick={() => setOpen(false)}
        >
          <NavLinks mobile />
          <div className="pt-3 border-t border-gray-100">
            <NavActions />
          </div>
        </div>
      )}
    </>
  )
}
