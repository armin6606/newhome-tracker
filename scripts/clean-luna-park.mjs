/**
 * Deletes all Isla (Luna Park) and Rhea (Luna Park) data from the DB
 * so they can be re-scraped cleanly with the fixed collection filter.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cecffcuzkyoxqzcewila.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlY2ZmY3V6a3lveHF6Y2V3aWxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5MDExOCwiZXhwIjoyMDg5MjY2MTE4fQ.FabMr-Ih-jB-7aLYzy4PWZRWOoVwUDP9dLole4l1oFc'
)

// Get community IDs
const { data: communities, error: cErr } = await supabase
  .from('Community')
  .select('id, name')
  .in('name', ['Isla (Luna Park)', 'Rhea (Luna Park)'])

if (cErr) { console.error('Error fetching communities:', cErr); process.exit(1) }
if (!communities || communities.length === 0) {
  console.log('No Isla/Rhea communities found — nothing to clean.')
  process.exit(0)
}

console.log('Communities to clean:')
for (const c of communities) console.log(`  [${c.id}] ${c.name}`)

const communityIds = communities.map(c => c.id)

// Get all listing IDs for these communities
const { data: listings } = await supabase
  .from('Listing')
  .select('id')
  .in('communityId', communityIds)

const listingIds = (listings || []).map(l => l.id)
console.log(`\nFound ${listingIds.length} listings to delete`)

if (listingIds.length > 0) {
  // Delete PriceHistory
  const { error: phErr } = await supabase
    .from('PriceHistory')
    .delete()
    .in('listingId', listingIds)
  if (phErr) { console.error('Error deleting PriceHistory:', phErr); process.exit(1) }
  console.log('  ✓ PriceHistory deleted')

  // Delete UserFavorite
  await supabase.from('UserFavorite').delete().in('listingId', listingIds)
  console.log('  ✓ UserFavorite deleted')

  // Delete Listings
  const { error: lErr } = await supabase
    .from('Listing')
    .delete()
    .in('communityId', communityIds)
  if (lErr) { console.error('Error deleting Listings:', lErr); process.exit(1) }
  console.log('  ✓ Listings deleted')
}

// Delete CommunityFollow
await supabase.from('CommunityFollow').delete().in('communityId', communityIds)
console.log('  ✓ CommunityFollow deleted')

// Delete Communities
const { error: commErr } = await supabase
  .from('Community')
  .delete()
  .in('id', communityIds)
if (commErr) { console.error('Error deleting Communities:', commErr); process.exit(1) }
console.log('  ✓ Communities deleted')

console.log('\nDone — Isla and Rhea wiped. Ready for clean re-scrape.')
