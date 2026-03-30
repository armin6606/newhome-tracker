import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cecffcuzkyoxqzcewila.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlY2ZmY3V6a3lveHF6Y2V3aWxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5MDExOCwiZXhwIjoyMDg5MjY2MTE4fQ.FabMr-Ih-jB-7aLYzy4PWZRWOoVwUDP9dLole4l1oFc'
)

const { data: communities } = await supabase
  .from('Community')
  .select('id, name')
  .in('name', ['Isla (Luna Park)', 'Rhea (Luna Park)'])

const communityIds = communities.map(c => c.id)

const { data: listings } = await supabase
  .from('Listing')
  .select('address, lotNumber, floorPlan, beds, baths, sqft, floors, currentPrice, pricePerSqft, hoaFees, taxes, moveInDate, status')
  .in('communityId', communityIds)
  .eq('status', 'active')
  .order('currentPrice', { ascending: true })

// Group by community
const communityMap = Object.fromEntries(communities.map(c => [c.id, c.name]))

// Re-fetch with community info
const { data: allListings } = await supabase
  .from('Listing')
  .select('address, floorPlan, beds, baths, sqft, floors, currentPrice, pricePerSqft, hoaFees, taxes, moveInDate, status, lotNumber, communityId')
  .in('communityId', communityIds)
  .order('communityId')
  .order('currentPrice', { ascending: true })

console.log('\n═══════════════════════════════════════════════════════════════════')
console.log(' Luna Park Active Listings — Isla & Rhea')
console.log('═══════════════════════════════════════════════════════════════════')

let lastCommunity = null
for (const l of allListings) {
  const community = communityMap[l.communityId]
  if (community !== lastCommunity) {
    console.log(`\n▌ ${community}`)
    console.log('  Lot  Address          Plan         Bd  Ba   Sqft  Fl   Price        $/sqft  HOA    Tax%    Status    Move-In')
    console.log('  ───  ───────────────  ───────────  ──  ───  ────  ──  ───────────  ──────  ─────  ──────  ────────  ───────────')
    lastCommunity = community
  }
  const lot     = (l.lotNumber || '—').padEnd(3)
  const addr    = (l.address || `Lot ${l.lotNumber}`).padEnd(15)
  const plan    = (l.floorPlan || '—').padEnd(11)
  const beds    = String(l.beds ?? '—').padStart(2)
  const baths   = String(l.baths ?? '—').padStart(3)
  const sqft    = String(l.sqft ?? '—').padStart(4)
  const floors  = String(l.floors ?? '—').padStart(2)
  const price   = l.currentPrice ? `$${l.currentPrice.toLocaleString()}`.padStart(11) : '—'.padStart(11)
  const ppsq    = l.pricePerSqft ? `$${l.pricePerSqft}`.padStart(6) : '—'.padStart(6)
  const hoa     = l.hoaFees ? `$${l.hoaFees}`.padStart(5) : '—'.padStart(5)
  const taxPct  = (l.taxes && l.currentPrice) ? `${((l.taxes/l.currentPrice)*100).toFixed(2)}%`.padStart(6) : '—'.padStart(6)
  const moveIn  = (l.moveInDate || '—')
  const statusLabel = l.status === 'active' ? 'For Sale' : l.status === 'sold' ? 'SOLD' : l.status
  console.log(`  ${lot}  ${addr}  ${plan}  ${beds}  ${baths}  ${sqft}  ${floors}  ${price}  ${ppsq}  ${hoa}  ${taxPct}  ${statusLabel.padEnd(8)}  ${moveIn}`)
}

console.log('\n')
