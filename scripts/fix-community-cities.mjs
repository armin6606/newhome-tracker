/**
 * Fix community city values that are stuck on "Orange County".
 * Strategy:
 *  1. For communities whose listing sourceUrls contain a city slug, extract it.
 *  2. Fall back to a hardcoded name→city map for well-known communities.
 *  3. Skip communities that are genuinely non-OC KB Home entries (bay-area, central-valley, etc.)
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// Title-case a slug: "yorba-linda" → "Yorba Linda"
function titleCase(slug) {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

// Extract city from a source URL using known builder patterns
function cityFromSourceUrl(url) {
  if (!url) return null
  // Lennar / Shea: /new-homes/california/orange-county/{city}/
  let m = url.match(/\/new-homes\/california\/orange-county\/([^/?#]+)/)
  if (m) return titleCase(m[1])

  // Pulte / Del Webb: /homes/california/orange-county/{city}/
  m = url.match(/\/homes\/california\/orange-county\/([^/?#]+)/)
  if (m) return titleCase(m[1])

  // Melia / City Ventures / Olson: /new-homes/ca/{city}/
  m = url.match(/\/new-homes\/ca\/([^/?#]+)\//)
  if (m) return titleCase(m[1])

  // Taylor Morrison: /ca/southern-california/{city}/
  m = url.match(/\/ca\/southern-california\/([^/?#]+)\//)
  if (m) return titleCase(m[1])

  // TRI Pointe: /ca/orange-county/{city}/
  m = url.match(/\/ca\/orange-county\/([^/?#]+)\//)
  if (m) return titleCase(m[1])

  // Brookfield: /new-homes/california/{county}/{city}/
  m = url.match(/\/new-homes\/california\/[^/]+\/([^/?#]+)\//)
  if (m) return titleCase(m[1])

  return null
}

// Hardcoded map for communities whose URLs don't expose city
const KNOWN_CITIES = {
  // Toll Brothers – The Meadows is in Lake Forest
  "The Evergreens At The Meadows": "Lake Forest",
  "The Sequoias At The Meadows":   "Lake Forest",
  // Vista Rose is in Orange, CA
  "Vista Rose": "Orange",
  // Pulte Luna Park communities are all in Irvine
  "Icon at Luna Park":     "Irvine",
  "Parallel at Luna Park": "Irvine",
  "Arden at Luna Park":    "Irvine",
  "Eclipse at Luna Park":  "Irvine",
  // Del Webb Luna is in Rancho Mission Viejo
  "Luna at Gavilan Ridge":  "Rancho Mission Viejo",
  // Bonanni – known locations
  "Covara":     "Brea",
  "Volara":     "Anaheim",
  "Coastlands": "Huntington Beach",
  "Bigsby":     "Fullerton",
  "Oak Pointe": "Orange",
  // TRI Pointe junk community names
  "Orange County, CA": "Orange County",   // keep as-is, it's a dummy entry
  "New Construction Homes in California": "Orange County",
  "Ready": "Orange County",
  // Shea junk entries
  "QUICK MOVE-INS AVAILABLE!": "Orange County",
  "Schedule a Tour": "Orange County",
  // Taylor Morrison junk
  "Master-Planned Living": "Orange County",
  "Join the Interest List": "Orange County",
  // Bonanni junk (URL-named communities)
  "https://www.livthevrv.com/":   "Orange County",
  "https://livelincolneast.com/": "Orange County",
}

async function main() {
  const communities = await prisma.community.findMany({
    where: { city: "Orange County" },
    select: {
      id: true, name: true,
      listings: { take: 10, select: { sourceUrl: true } },
    },
  })

  console.log(`Found ${communities.length} communities with city = "Orange County"`)

  let updated = 0
  for (const c of communities) {
    let newCity = null

    // 1. Try extracting from listing source URLs
    for (const l of c.listings) {
      const city = cityFromSourceUrl(l.sourceUrl)
      if (city && city.toLowerCase() !== "orange county") {
        newCity = city
        break
      }
    }

    // 2. Try community URL itself
    if (!newCity) {
      const communityUrl = c.listings[0]?.sourceUrl || ""
      const city = cityFromSourceUrl(communityUrl)
      if (city && city.toLowerCase() !== "orange county") newCity = city
    }

    // 3. Hardcoded fallback
    if (!newCity && KNOWN_CITIES[c.name] !== undefined) {
      newCity = KNOWN_CITIES[c.name]
    }

    if (newCity && newCity !== "Orange County") {
      await prisma.community.update({ where: { id: c.id }, data: { city: newCity } })
      console.log(`  ✓ "${c.name}" → ${newCity}`)
      updated++
    } else {
      console.log(`  ✗ "${c.name}" — no city found`)
    }
  }

  console.log(`\nUpdated ${updated}/${communities.length} communities.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
