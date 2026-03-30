/**
 * Cleans all Listing and Community records from the DB.
 * Uses Prisma via subprocess so FK constraints are handled properly.
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cecffcuzkyoxqzcewila.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlY2ZmY3V6a3lveHF6Y2V3aWxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5MDExOCwiZXhwIjoyMDg5MjY2MTE4fQ.FabMr-Ih-jB-7aLYzy4PWZRWOoVwUDP9dLole4l1oFc'
)

// Step 1: Delete dependent tables first
console.log('Deleting PriceHistory...')
const { error: eph } = await supabase.from('PriceHistory').delete().gte('id', 0)
if (eph) console.error('PriceHistory error:', eph)
else console.log('  PriceHistory cleared.')

console.log('Deleting UserFavorite...')
const { error: euf } = await supabase.from('UserFavorite').delete().gte('id', 0)
if (euf) console.error('UserFavorite error:', euf)
else console.log('  UserFavorite cleared.')

console.log('Deleting CommunityFollow...')
const { error: ecf } = await supabase.from('CommunityFollow').delete().gte('id', 0)
if (ecf) console.error('CommunityFollow error:', ecf)
else console.log('  CommunityFollow cleared.')

// Step 2: Delete listings
console.log('Deleting Listings...')
const { error: el } = await supabase.from('Listing').delete().gte('id', 0)
if (el) console.error('Listing error:', el)
else console.log('  Listing cleared.')

// Step 3: Delete communities
console.log('Deleting Communities...')
const { error: ec } = await supabase.from('Community').delete().gte('id', 0)
if (ec) console.error('Community error:', ec)
else console.log('  Community cleared.')

// Verify
const { count: lCount } = await supabase.from('Listing').select('id', { count: 'exact', head: true })
const { count: cCount } = await supabase.from('Community').select('id', { count: 'exact', head: true })
console.log(`\nDone. Listings remaining: ${lCount ?? 0}, Communities remaining: ${cCount ?? 0}`)
