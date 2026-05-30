import type { PrismaClient } from "@prisma/client"

type CommunityDefaults = {
  city?: string
  state?: string
}

export function normalizeCommunityUrl(url: string | null | undefined): string {
  if (!url) return ""
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    parsed.pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase()
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|gclid|gbraid|gad_|fbclid)/i.test(key)) parsed.searchParams.delete(key)
    }
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search ? `?${parsed.searchParams.toString()}` : ""}`
  } catch {
    return url.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "")
  }
}

export async function findExistingCommunityForScrape(
  prisma: PrismaClient,
  builderId: number,
  communityName: string,
  communityUrl: string
) {
  const normalizedUrl = normalizeCommunityUrl(communityUrl)
  if (normalizedUrl) {
    const communities = await prisma.community.findMany({
      where: { builderId },
      select: { id: true, name: true, url: true },
    })
    const byUrl = communities.find((community) => normalizeCommunityUrl(community.url) === normalizedUrl)
    if (byUrl) return { ...byUrl, matchedBy: "url" as const }
  }

  const byName = await prisma.community.findUnique({
    where: { builderId_name: { builderId, name: communityName } },
    select: { id: true, name: true, url: true },
  })
  return byName ? { ...byName, matchedBy: "name" as const } : null
}

export async function upsertCommunityForScrape(
  prisma: PrismaClient,
  builderId: number,
  communityName: string,
  communityUrl: string,
  defaults: CommunityDefaults = {}
) {
  const existing = await findExistingCommunityForScrape(prisma, builderId, communityName, communityUrl)
  const data = {
    url: communityUrl,
    ...(defaults.city ? { city: defaults.city } : {}),
    ...(defaults.state ? { state: defaults.state } : {}),
  }

  if (existing) {
    return prisma.community.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.community.upsert({
    where: { builderId_name: { builderId, name: communityName } },
    update: data,
    create: {
      builderId,
      name: communityName,
      city: defaults.city ?? "Orange County",
      state: defaults.state ?? "CA",
      url: communityUrl,
    },
  })
}
