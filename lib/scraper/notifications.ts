/**
 * Sends email notifications to users who have:
 *   - favorited a listing that just changed price
 *   - followed a community that just got new listings
 *
 * Called from detect-changes.ts after each scrape run.
 * Uses the Supabase service-role client to look up user emails
 * (Supabase Auth stores emails in auth.users, not accessible via Prisma).
 */

import { prisma } from "@/lib/db"
import { getSupabaseAdmin } from "@/lib/supabase/service"
import { getResend, FROM_EMAIL } from "@/lib/email/resend"
import {
  priceChangeSubject,
  priceChangeHtml,
  newListingSubject,
  newListingHtml,
  type PriceChangeData,
  type NewListingData,
} from "@/lib/email/templates"

// ─── Price change notifications ───────────────────────────────────────────────

export async function notifyPriceChange(params: {
  listingId: number
  oldPrice: number
  newPrice: number
  changeType: "increase" | "decrease"
}) {
  const { listingId, oldPrice, newPrice, changeType } = params

  // Find all users who favorited this listing
  const favorites = await prisma.userFavorite.findMany({
    where: { listingId },
    select: { userId: true },
  })
  if (!favorites.length) return

  // Get listing info for email
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { community: true },
  })
  if (!listing) return

  // Get user emails from Supabase Auth
  const userIds = favorites.map((f) => f.userId)
  const emails = await getUserEmails(userIds)

  const data: PriceChangeData = {
    address: listing.address,
    community: listing.community.name,
    listingId,
    oldPrice,
    newPrice,
    changeType,
    sqft: listing.sqft,
    beds: listing.beds,
    baths: listing.baths,
    sourceUrl: listing.sourceUrl,
  }

  for (const { userId, email } of emails) {
    // Check dedup: don't send the same price-change email twice in 24h
    const recent = await prisma.notificationLog.findFirst({
      where: {
        userId,
        type: "price_change",
        listingId,
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (recent) continue

    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: priceChangeSubject(data),
        html: priceChangeHtml(data),
      })

      await prisma.notificationLog.create({
        data: { userId, type: "price_change", listingId, emailSentTo: email },
      })
    } catch (err) {
      console.error(`Failed to send price change email to ${email}:`, err)
    }
  }
}

// ─── New listing notifications ────────────────────────────────────────────────

export async function notifyNewListings(params: {
  communityId: number
  newListingIds: number[]
}) {
  const { communityId, newListingIds } = params
  if (!newListingIds.length) return

  // Find all users following this community
  const follows = await prisma.communityFollow.findMany({
    where: { communityId },
    select: { userId: true },
  })
  if (!follows.length) return

  // Get new listing details
  const listings = await prisma.listing.findMany({
    where: { id: { in: newListingIds } },
    include: { community: true },
  })
  if (!listings.length) return

  const communityName = listings[0].community.name
  const userIds = follows.map((f) => f.userId)
  const emails = await getUserEmails(userIds)

  const data: NewListingData = {
    communityName,
    communityId,
    listings: listings.map((l) => ({
      id: l.id,
      address: l.address,
      currentPrice: l.currentPrice,
      beds: l.beds,
      baths: l.baths,
      sqft: l.sqft,
      floorPlan: l.floorPlan,
    })),
  }

  for (const { userId, email } of emails) {
    // Dedup: don't send new-listing email for the same community+listings within 24h
    const recent = await prisma.notificationLog.findFirst({
      where: {
        userId,
        type: "new_listing",
        communityId,
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    if (recent) continue

    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: newListingSubject(data),
        html: newListingHtml(data),
      })

      await prisma.notificationLog.create({
        data: { userId, type: "new_listing", communityId, emailSentTo: email },
      })
    } catch (err) {
      console.error(`Failed to send new listing email to ${email}:`, err)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserEmails(
  userIds: string[]
): Promise<{ userId: string; email: string }[]> {
  const results: { userId: string; email: string }[] = []

  // Supabase admin API — listUsers supports pagination; batch if needed
  const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({
    perPage: 1000,
  })
  if (error || !data) return results

  const emailMap = new Map(data.users.map((u) => [u.id, u.email ?? ""]))

  for (const userId of userIds) {
    const email = emailMap.get(userId)
    if (email) results.push({ userId, email })
  }

  return results
}
