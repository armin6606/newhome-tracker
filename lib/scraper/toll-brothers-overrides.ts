export interface TollCommunityOverride {
  lotNumbers?: string[]
  lotRanges?: Array<[number, number]>
}

export const TOLL_COMMUNITY_OVERRIDES: Record<string, TollCommunityOverride> = {
  // Add explicit lot ranges or lot numbers here for master-map communities
  // whose SVG does not expose a community-specific site plan.
  //
  // Example:
  // "Skyline": { lotRanges: [[1, 42]] },
  // "Pinnacle": { lotNumbers: ["84", "98", "102", "103"] },
}

export function normalizeTollCommunityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(collection|at|by|toll|brothers|in|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function getTollCommunityOverride(communityName: string): TollCommunityOverride | undefined {
  const normalized = normalizeTollCommunityName(communityName)
  return Object.entries(TOLL_COMMUNITY_OVERRIDES).find(([name]) =>
    normalizeTollCommunityName(name) === normalized
  )?.[1]
}

export function isLotAllowedByOverride(lotNumber: string, override: TollCommunityOverride): boolean {
  if (override.lotNumbers?.includes(lotNumber)) return true

  const numericLot = parseInt(lotNumber, 10)
  if (!Number.isFinite(numericLot)) return false

  return override.lotRanges?.some(([start, end]) =>
    numericLot >= start && numericLot <= end
  ) ?? false
}
