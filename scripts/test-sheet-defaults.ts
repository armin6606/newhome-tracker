import { fetchUrlsTab, fetchMainTabMeta, matchMetaForCommunity, applySheetDefaults } from "@/lib/scraper/sheet-controller"

async function main() {
  const [urls, meta] = await Promise.all([fetchUrlsTab(), fetchMainTabMeta()])

  const testCases = [
    { communityKey: "Nova",   floorPlan: "Nova 2",   address: "218 Bounty" },
    { communityKey: "Nova",   floorPlan: "Nova 3X",  address: "211 Bounty" },
    { communityKey: "Strata", floorPlan: "Strata 2X",address: "886 Spirit" },
    { communityKey: "Isla",   floorPlan: "Isla 2B",  address: "828 Sonia"  },
    { communityKey: "Rhea",   floorPlan: "Rhea 4",   address: "100 Harrier"},
    { communityKey: "Torrey", floorPlan: "Torrey 4", address: "1724 Lychee"},
  ]

  console.log(`${"Community".padEnd(10)} ${"Input Plan".padEnd(14)} → ${"Output Plan".padEnd(14)} beds baths sqft  floors HOA`)
  console.log("─".repeat(80))

  for (const tc of testCases) {
    const urlRow = urls.find(r => r.communityName === tc.communityKey)
    if (!urlRow) { console.log(`No URL row for ${tc.communityKey}`); continue }

    const communityMeta = matchMetaForCommunity(meta, tc.communityKey)
    const mockListing = {
      communityName: "", communityUrl: "", city: "", address: tc.address,
      floorPlan: tc.floorPlan, beds: undefined, baths: undefined, sqft: undefined,
      floors: undefined, sourceUrl: "",
    }
    const [result] = applySheetDefaults([mockListing], urlRow, communityMeta)

    console.log(
      `${tc.communityKey.padEnd(10)} ${tc.floorPlan.padEnd(14)} → ${String(result.floorPlan ?? "—").padEnd(14)}` +
      ` ${String(result.beds ?? "—").padEnd(4)} ${String(result.baths ?? "—").padEnd(5)} ${String(result.sqft ?? "—").padEnd(6)}` +
      ` ${String(result.floors ?? "—").padEnd(6)} ${result.hoaFees ?? "—"}`
    )
  }
}

main().catch(console.error)
