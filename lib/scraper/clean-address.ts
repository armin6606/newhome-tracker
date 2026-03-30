/**
 * Shared address cleaner for all scrapers.
 * Rule: keep ONLY street number + street name.
 * Strip: city, state, zip, unit/apt, street type suffixes.
 */

const STREET_SUFFIXES = [
  "Street", "St",
  "Avenue", "Ave",
  "Boulevard", "Blvd",
  "Drive", "Dr",
  "Road", "Rd",
  "Lane", "Ln",
  "Court", "Ct",
  "Place", "Pl",
  "Way",
  "Circle", "Cir",
  "Terrace", "Ter",
  "Trail", "Trl",
  "Parkway", "Pkwy",
  "Loop", "Run", "Path", "Pass",
  "Alley", "Ally",
  "Highway", "Hwy",
  "Freeway", "Fwy",
]

const SUFFIX_REGEX = new RegExp(
  `\\s+(${STREET_SUFFIXES.join("|")})\\.?\\s*$`,
  "i"
)

const CITY_NAMES = [
  "Rancho Mission Viejo", "Rancho Mission",
  "Yorba Linda", "Yorba",
  "Irvine", "Fullerton", "Anaheim", "Orange",
  "Garden Grove", "Huntington Beach", "Lake Forest",
  "Santa Ana", "Newport Beach", "Laguna Niguel", "Laguna Beach",
  "Tustin", "Cypress", "Brea", "La Habra",
  "Fountain Valley", "Stanton", "Long Beach",
  "Mission Viejo", "Aliso Viejo", "Dana Point",
  "San Clemente", "San Juan Capistrano",
  // Non-OC (KB Home etc. scraped outside OC)
  "American Canyon", "Antioch", "Vacaville", "Fremont",
  "Castro Valley", "Hollister", "San Jose", "Daly City",
  "Morgan Hill", "Mountain House", "Lodi", "Stockton",
  "Manteca", "Riverbank", "Lathrop", "Modesto", "Hughson",
  "Patterson", "Fresno", "Clovis", "Santa Clarita",
  "Moorpark", "Ventura", "Valencia", "Pico Rivera",
  "El Monte", "South El Monte", "Elk Grove",
]

// Sort longest first so "Rancho Mission Viejo" matches before "Rancho Mission"
const CITY_REGEX = new RegExp(
  `\\s+(${CITY_NAMES.sort((a, b) => b.length - a.length).join("|")})\\s*$`,
  "i"
)

export function cleanAddress(raw: string | null | undefined): string {
  if (!raw) return ""

  let addr = raw
    // Normalize whitespace and newlines
    .replace(/\s+/g, " ")
    // Remove "- Plan X" or "- Plans Available" suffix
    .replace(/\s*[-–]\s*plan\s*.+$/i, "")
    // Remove unit/apt/suite/# designators
    .replace(/,?\s*(unit|apt|suite|#)\s*[\w-]+/gi, "")
    // Remove everything from comma onward (city, state, zip)
    .replace(/,.*$/, "")
    // Remove "CA" + optional zip at end
    .replace(/\s+CA\s*\d{0,5}\s*$/i, "")
    // Remove bare zip codes at end
    .replace(/\s+\d{5}(-\d{4})?\s*$/, "")
    .trim()

  // Strip city names (longest-first to avoid partial matches)
  addr = addr.replace(CITY_REGEX, "").trim()

  // Strip street type suffix
  addr = addr.replace(SUFFIX_REGEX, "").trim()

  // Remove trailing periods
  addr = addr.replace(/\.*$/, "").trim()

  return addr
}
