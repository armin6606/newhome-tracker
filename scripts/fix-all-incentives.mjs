/**
 * One-time fix: Update incentive text for all builders based on actual current promotions.
 * Also fixes Great Park community assignments.
 */
import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

// Real promotions sourced from builder websites (March 2026)
const BUILDER_PROMOTIONS = {
  "Lennar": "Everything's Included — select quick move-in homes available with special financing. Contact Lennar for current rate buydown and closing cost credit details.",
  "Taylor Morrison": "Reduced Rate Financing — No Monthly Mortgage Insurance on select Quick Move-in or To-Be-Built homes. Conventional loan, min $225K loan, 680+ credit score, up to 95% LTV. Through Taylor Morrison Home Funding. Limited funding pool. Valid through 3/31/2026.",
  "Toll Brothers": null, // Already has full details
  "KB Home": "Tax Refund Homebuyer Program — use your tax refund toward down payment or closing costs on a new KB Home. Contact KB Home for current financing incentives in your area.",
  "TRI Pointe Homes": "Savings Designed Around You — limited-time incentives and exclusive offers on select Tri Pointe Homes. Contact for current community-specific offers.",
  "Shea Homes": "Inventory Homes Available — lock in your interest rate sooner on quick move-in and under-construction homes in select communities.",
  "Brookfield Residential": "70 Years of Home Sale — save BIG with low rates on select quick move-in homes. New contracts 2/13/26–3/31/26. Terms and conditions apply.",
  "Pulte Homes": null, // No promotions page found
  "Del Webb": null, // No promotions page found
  "Melia Homes": null, // No promotions found
}

async function main() {
  console.log("=== Fixing incentives for all builders ===\n")

  for (const [builderName, promo] of Object.entries(BUILDER_PROMOTIONS)) {
    if (!promo) {
      console.log(`[${builderName}] No promotion to apply, skipping`)
      continue
    }

    // Skip Toll Brothers — already has real data
    if (builderName === "Toll Brothers") continue

    const builder = await p.builder.findUnique({ where: { name: builderName } })
    if (!builder) {
      console.log(`[${builderName}] Builder not found, skipping`)
      continue
    }

    // Update all active listings that have no incentives OR have the generic "Slam-Dunk" text
    const result = await p.listing.updateMany({
      where: {
        community: { builderId: builder.id },
        status: "active",
        OR: [
          { incentives: null },
          { incentives: { contains: "Slam-Dunk" } },
          { incentives: { contains: "View offer" } },
        ],
      },
      data: { incentives: promo },
    })

    console.log(`[${builderName}] Updated ${result.count} listings with: "${promo.slice(0, 80)}..."`)
  }

  // === Fix Great Park community assignments ===
  console.log("\n=== Fixing Great Park community assignments ===\n")

  const PLAN_MAP = {
    rhea: "Rhea at Luna Park",
    isla: "Isla at Luna Park",
    nova: "Nova - Active Adult",
    strata: "Strata - Active Adult",
  }

  const gpCommunity = await p.community.findFirst({
    where: { name: "Great Park Neighborhoods", builder: { name: "Lennar" } },
    include: { builder: true },
  })

  if (!gpCommunity) {
    console.log("No 'Great Park Neighborhoods' community found.")
  } else {
    const listings = await p.listing.findMany({
      where: { communityId: gpCommunity.id },
      select: { id: true, address: true, floorPlan: true, status: true },
    })

    console.log(`Found ${listings.length} listings in Great Park Neighborhoods`)

    let moved = 0
    let skipped = 0
    for (const listing of listings) {
      const planPrefix = (listing.floorPlan || "").split(/\s+/)[0].toLowerCase()
      const targetName = PLAN_MAP[planPrefix]
      if (!targetName) {
        console.log(`  Skip ${listing.address} — plan "${listing.floorPlan}" not mapped`)
        skipped++
        continue
      }

      const targetCommunity = await p.community.findFirst({
        where: { name: targetName, builderId: gpCommunity.builderId },
      })

      if (!targetCommunity) {
        console.log(`  Skip ${listing.address} — community "${targetName}" not found in DB`)
        skipped++
        continue
      }

      // Check if same address already exists in target community (avoid P2002)
      const existing = await p.listing.findFirst({
        where: { communityId: targetCommunity.id, address: listing.address },
      })

      if (existing) {
        // Delete the duplicate from Great Park instead
        await p.listing.delete({ where: { id: listing.id } })
        console.log(`  Deleted duplicate ${listing.address} from Great Park (already in ${targetName})`)
        moved++
      } else {
        await p.listing.update({
          where: { id: listing.id },
          data: { communityId: targetCommunity.id },
        })
        console.log(`  Moved ${listing.address} (${listing.floorPlan}) → ${targetName}`)
        moved++
      }
    }

    console.log(`\nMoved/cleaned ${moved}, skipped ${skipped}`)

    // Mark Great Park as excluded
    const remaining = await p.listing.count({ where: { communityId: gpCommunity.id } })
    if (remaining === 0) {
      await p.community.update({ where: { id: gpCommunity.id }, data: { excluded: true } })
      console.log("Marked 'Great Park Neighborhoods' as excluded")
    } else {
      console.log(`${remaining} listings still in Great Park Neighborhoods`)
    }
  }

  console.log("\n=== Done ===")
}

main().catch(console.error).finally(() => p.$disconnect())
