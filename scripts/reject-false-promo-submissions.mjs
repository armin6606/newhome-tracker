import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const BOILERPLATE_PATTERNS = [
  /prices?\s+may\s+not\s+include/i,
  /prices?.*promotions?.*incentives?.*subject\s+to\s+change/i,
  /features?.*options?.*amenities?.*floor\s+plans?.*subject\s+to\s+change/i,
  /square\s+footage.*estimated/i,
  /copyright\s+©?\s*\d{4}/i,
  /all\s+rights\s+reserved/i,
  /privacy\s+policy/i,
  /terms\s+of\s+use/i,
  /unsubscribe/i,
]

const STRONG_PROMO_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:off|credit|bonus|savings?|toward|incentive|closing)/i,
  /\d+(?:\.\d+)?\s?%\s*(?:apr|rate|interest|financing|mortgage|buydown)/i,
  /(?:save|savings)\s+(?:up\s+to\s+)?(?:\$|\d)/i,
  /(?:closing\s+cost|design|upgrade|flex\s+cash|rate\s+buy[-\s]?down|buydown)\s+(?:credit|assistance|savings?|offer|incentive)/i,
  /(?:special|limited[-\s]?time)\s+(?:financing|rate|offer|incentive|promotion|savings)/i,
  /(?:below[-\s]?market|reduced)\s+(?:interest\s+)?rate/i,
]

function isBoilerplate(text) {
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text))
}

function hasStrongPromoSignal(text) {
  return STRONG_PROMO_PATTERNS.some((pattern) => pattern.test(text))
}

function rejectReason(promo) {
  const text = `${promo.offerText ?? ""}\n${promo.rawSnippet ?? ""}`
  if (isBoilerplate(promo.offerText ?? "")) return "Rejected automatically: offer text is legal/disclaimer boilerplate, not an incentive."
  if (isBoilerplate(text) && !hasStrongPromoSignal(text)) return "Rejected automatically: email only contains footer/disclaimer promo words."
  if (!hasStrongPromoSignal(promo.offerText ?? "")) return "Rejected automatically: no specific incentive amount, rate, credit, or offer detected."
  return null
}

async function main() {
  const pending = await prisma.promoSubmission.findMany({
    where: { status: "pending" },
    select: {
      id: true,
      offerText: true,
      rawSnippet: true,
      notes: true,
    },
  })

  let rejected = 0
  for (const promo of pending) {
    const reason = rejectReason(promo)
    if (!reason) continue

    const notes = [promo.notes, reason].filter(Boolean).join(" ")
    await prisma.promoSubmission.update({
      where: { id: promo.id },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
        notes,
      },
    })
    rejected++
    console.log(`Rejected promo #${promo.id}: ${reason}`)
  }

  console.log(`Rejected ${rejected} false promo submission(s).`)
}

main().catch(async (err) => {
  console.error("Failed to reject false promo submissions:", err)
  await prisma.$disconnect()
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})
