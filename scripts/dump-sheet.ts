import { fetchUrlsTab, fetchMainTabMeta } from "@/lib/scraper/sheet-controller"

async function main() {
  const [urls, meta] = await Promise.all([fetchUrlsTab(), fetchMainTabMeta()])

  console.log("=== URLs tab (Toll Brothers) ===")
  urls.filter(r => r.builder === "Toll Brothers").forEach(r =>
    console.log(`  ${r.communityName} → ${r.url}`)
  )

  console.log("\n=== Main tab — all communities ===")
  for (const [name, m] of meta) {
    console.log(`\n${name}`)
    console.log(`  city=${m.city} | hoa=${m.hoa ?? "—"} | taxRate=${m.taxRate ?? "—"} | defaultFloors=${m.defaultFloors ?? "—"} | schools=${m.schools ?? "—"}`)
    if (m.plans.size === 0) {
      console.log("  (no plans)")
    } else {
      for (const [variant, p] of m.plans) {
        console.log(`  plan "${variant}" → planName="${p.planName}" beds=${p.beds ?? "—"} baths=${p.baths ?? "—"} sqft=${p.sqft ?? "—"} floors=${p.floors ?? "—"}`)
      }
    }
  }
}

main().catch(console.error)
