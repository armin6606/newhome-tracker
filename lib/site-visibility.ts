import { BUILDER_SHEET_TABS } from "@/lib/sheet-validator"

export const PLACEHOLDER_LOT_RE = /^(sold|avail|future)-\d+$/
export const LOT_ONLY_ADDRESS_RE = /^lot\s+\d+$/i

export function isSupportedBuilder(builderName: string): boolean {
  return Boolean(BUILDER_SHEET_TABS[builderName])
}

export function isRealListing(l: { address: string | null; lotNumber?: string | null }): boolean {
  return (
    l.address !== null &&
    !LOT_ONLY_ADDRESS_RE.test(l.address.trim()) &&
    !(l.lotNumber && PLACEHOLDER_LOT_RE.test(l.lotNumber))
  )
}

export function isVisibleCommunity(c: {
  builder: { name: string }
  lastScrapedAt: Date | string | null
  listings: { address: string | null; lotNumber?: string | null; status: string; currentPrice?: number | null }[]
}): boolean {
  if (!isSupportedBuilder(c.builder.name)) return false

  const real = c.listings.filter(isRealListing)
  const active = real.filter((l) => l.status === "for sale" && l.currentPrice !== null).length
  const sold = real.filter((l) => l.status === "sold").length
  const future = real.filter((l) => l.status === "future").length
  const isFutureOnly = active === 0 && sold === 0 && future > 0

  return c.lastScrapedAt !== null || isFutureOnly
}

export function visibleListingCommunityWhere() {
  return {
    builder: { name: { in: Object.keys(BUILDER_SHEET_TABS) } },
    OR: [
      { lastScrapedAt: { not: null } },
      {
        listings: {
          some: {
            status: "future",
            address: { not: null },
            NOT: [
              { lotNumber: { startsWith: "future-" } },
              { address: { startsWith: "future-" } },
            ],
          },
        },
      },
    ],
  }
}
