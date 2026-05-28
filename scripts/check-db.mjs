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

const { data: communities } = await supabase.from('Community').select('id, name')
const { data: activeListings } = await supabase.from('Listing').select('id, address, status, currentPrice').eq('status', 'active')
const { data: soldListings } = await supabase.from('Listing').select('id').eq('status', 'sold')
const { count: totalCount } = await supabase.from('Listing').select('id', { count: 'exact', head: true })

console.log('Communities:', communities?.map(c => c.name))
console.log('Total listings:', totalCount)
console.log('Active listings:', activeListings?.length, activeListings?.map(l => `${l.address} $${l.currentPrice}`))
console.log('Sold listings:', soldListings?.length)
