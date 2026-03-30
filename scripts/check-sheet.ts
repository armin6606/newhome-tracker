import { fetchUrlsTab, fetchMainTabMeta } from "@/lib/scraper/sheet-controller"

async function main() {
  const [urls, meta] = await Promise.all([fetchUrlsTab(), fetchMainTabMeta()])

  console.log("=== URLs Tab ===")
  if (urls.length === 0) console.log("  (empty)")
  urls.forEach(r => console.log(`  [${r.builder}] ${r.communityName} → ${r.url}`))

  console.log("\n=== Main Tab ===")
  if (meta.size === 0) console.log("  (empty)")
  for (const [name, m] of meta.entries()) {
    console.log(`\n  ${name} | builder=${m.builder} | city=${m.city} | HOA=${m.hoa ?? "—"} | taxRate=${m.taxRate ?? "—"} | type=${m.propertyType ?? "—"}`)
    if (m.plans.size === 0) {
      console.log("    (no plans)")
    }
    for (const [variant, p] of m.plans.entries()) {
      console.log(`    plan="${variant}" | beds=${p.beds ?? "—"} baths=${p.baths ?? "—"} sqft=${p.sqft ?? "—"} floors=${p.floors ?? "—"}`)
    }
  }
}

main().catch(console.error)
