import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const BUILDER_NAMES = [
  "Toll Brothers",
  "Lennar",
  "KB Home",
  "Taylor Morrison",
  "TRI Pointe Homes",
  "TRI Pointe",
  "Shea Homes",
  "Melia Homes",
  "Brookfield Residential",
  "Brookfield",
  "Pulte Homes",
  "Pulte",
  "Del Webb",
]

export function cleanCommunityName(name: string): string {
  let n = name
  // Strip "Builder Name at/by/in X" patterns
  n = n.replace(/^toll brothers\s+(at|in|by|of)\s+/i, "")
  n = n.replace(/\s+by\s+toll\s+brothers/i, "")
  n = n.replace(/^toll brothers\s+/i, "")
  // Strip any builder name that appears anywhere
  for (const b of BUILDER_NAMES) {
    const escaped = b.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&")
    n = n.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
  }
  // Standardize "Great Park Neighborhoods"
  n = n.replace(/great park neighborhoods/i, "Great Park")
  // Strip " at <Location>" suffix
  n = n.replace(/\s+at\s+[\w\s]+$/i, "")
  // Strip the word "Collection" (keep the collection sub-name like "Elm", "Birch")
  n = n.replace(/\s+Collection\b/gi, "")
  // Strip dangling prepositions/conjunctions left behind
  n = n.replace(/\s+(by|at|in|of|the|a|and)\s*$/i, "")
  // Collapse whitespace and clean up dashes
  n = n.replace(/\s*[-–]\s*$/, "").replace(/\s+/g, " ").trim()
  return n
}

export function formatPrice(price: number | null | undefined): string {
  if (!price) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price)
}

export function formatNumber(n: number | null | undefined): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US").format(n)
}

export function daysAgo(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}
