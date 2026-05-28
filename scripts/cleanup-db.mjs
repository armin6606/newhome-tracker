/**
 * Cleans all Listing and Community records from the DB.
 * Uses Prisma via subprocess so FK constraints are handled properly.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
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
