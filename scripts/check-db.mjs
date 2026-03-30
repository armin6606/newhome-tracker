import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cecffcuzkyoxqzcewila.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlY2ZmY3V6a3lveHF6Y2V3aWxhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5MDExOCwiZXhwIjoyMDg5MjY2MTE4fQ.FabMr-Ih-jB-7aLYzy4PWZRWOoVwUDP9dLole4l1oFc'
)

const { data: communities } = await supabase.from('Community').select('id, name')
const { data: activeListings } = await supabase.from('Listing').select('id, address, status, currentPrice').eq('status', 'active')
const { data: soldListings } = await supabase.from('Listing').select('id').eq('status', 'sold')
const { count: totalCount } = await supabase.from('Listing').select('id', { count: 'exact', head: true })

console.log('Communities:', communities?.map(c => c.name))
console.log('Total listings:', totalCount)
console.log('Active listings:', activeListings?.length, activeListings?.map(l => `${l.address} $${l.currentPrice}`))
console.log('Sold listings:', soldListings?.length)
