import { prisma } from "@/lib/db"

async function main() {
  const listings = await prisma.listing.findMany({
    where: {
      status: "active",
      community: { builder: { name: { in: ["Lennar", "Toll Brothers"] } } },
    },
    include: { community: { include: { builder: true } } },
    orderBy: [
      { community: { builder: { name: "asc" } } },
      { community: { name: "asc" } },
      { address: "asc" },
    ],
  })

  console.log(`Total active listings (Lennar + Toll): ${listings.length}\n`)

  let missingCount = 0
  const byBuilder: Record<string, typeof listings> = {}
  for (const l of listings) {
    const b = l.community.builder.name
    if (!byBuilder[b]) byBuilder[b] = []
    byBuilder[b].push(l)
  }

  for (const [builder, rows] of Object.entries(byBuilder)) {
    console.log(`\n${"═".repeat(70)}`)
    console.log(`  ${builder} — ${rows.length} active listings`)
    console.log(`${"═".repeat(70)}`)

    const byCommunity: Record<string, typeof rows> = {}
    for (const l of rows) {
      const c = l.community.name
      if (!byCommunity[c]) byCommunity[c] = []
      byCommunity[c].push(l)
    }

    for (const [community, listings] of Object.entries(byCommunity)) {
      console.log(`\n  ── ${community}`)
      for (const l of listings) {
        const missing: string[] = []
        if (!l.beds) missing.push("beds")
        if (!l.baths) missing.push("baths")
        if (!l.sqft) missing.push("sqft")
        if (!l.currentPrice) missing.push("price")
        if (!l.floorPlan) missing.push("plan")

        const flag = missing.length ? `  ⚠ MISSING: ${missing.join(", ")}` : "  ✓"
        if (missing.length) missingCount++

        console.log(
          `    ${(l.address ?? "(no addr)").padEnd(22)} | plan=${String(l.floorPlan ?? "—").padEnd(14)} | ` +
          `beds=${String(l.beds ?? "—").padEnd(4)} baths=${String(l.baths ?? "—").padEnd(4)} sqft=${String(l.sqft ?? "—").padEnd(6)} price=${l.currentPrice ? "$" + l.currentPrice.toLocaleString() : "—"}` +
          flag
        )
      }
    }
  }

  console.log(`\n${"─".repeat(70)}`)
  console.log(`  Listings with missing fields: ${missingCount} / ${listings.length}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
