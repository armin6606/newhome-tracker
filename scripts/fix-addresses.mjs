import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const STREET_SUFFIXES = [
  "Street","St","Avenue","Ave","Boulevard","Blvd","Drive","Dr","Road","Rd",
  "Lane","Ln","Court","Ct","Place","Pl","Way","Circle","Cir","Terrace","Ter",
  "Trail","Trl","Parkway","Pkwy","Loop","Run","Path","Pass","Alley","Ally",
  "Highway","Hwy","Freeway","Fwy",
]

const CITY_NAMES = [
  "Rancho Mission Viejo","Rancho Mission","Yorba Linda","Yorba",
  "Irvine","Fullerton","Anaheim","Orange","Garden Grove","Huntington Beach",
  "Lake Forest","Santa Ana","Newport Beach","Laguna Niguel","Laguna Beach",
  "Tustin","Cypress","Brea","La Habra","Fountain Valley","Stanton","Long Beach",
  "Mission Viejo","Aliso Viejo","Dana Point","San Clemente","San Juan Capistrano",
  "American Canyon","Antioch","Vacaville","Fremont","Castro Valley","Hollister",
  "San Jose","Daly City","Morgan Hill","Mountain House","Lodi","Stockton",
  "Manteca","Riverbank","Lathrop","Modesto","Hughson","Patterson","Fresno",
  "Clovis","Santa Clarita","Moorpark","Ventura","Valencia","Pico Rivera",
  "El Monte","South El Monte","Elk Grove",
]

const SUFFIX_REGEX = new RegExp(`\\s+(${STREET_SUFFIXES.join("|")})\\.?\\s*$`, "i")
const CITY_REGEX = new RegExp(
  `\\s+(${CITY_NAMES.sort((a, b) => b.length - a.length).join("|")})\\s*$`, "i"
)

function cleanAddress(raw) {
  if (!raw) return ""
  let addr = raw
    .replace(/\s+/g, " ")
    .replace(/\s*[-–]\s*plan\s*.+$/i, "")
    .replace(/,?\s*(unit|apt|suite|#)\s*[\w-]+/gi, "")
    .replace(/,.*$/, "")
    .replace(/\s+CA\s*\d{0,5}\s*$/i, "")
    .replace(/\s+\d{5}(-\d{4})?\s*$/, "")
    .trim()
  addr = addr.replace(CITY_REGEX, "").trim()
  addr = addr.replace(SUFFIX_REGEX, "").trim()
  addr = addr.replace(/\.*$/, "").trim()
  return addr
}

async function main() {
  const listings = await prisma.listing.findMany({ select: { id: true, address: true } })
  let updated = 0

  for (const l of listings) {
    const cleaned = cleanAddress(l.address)
    if (cleaned !== l.address) {
      await prisma.listing.update({ where: { id: l.id }, data: { address: cleaned } })
      console.log(`  ${l.id}: "${l.address}" → "${cleaned}"`)
      updated++
    }
  }

  console.log(`\nUpdated ${updated}/${listings.length} addresses.`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
