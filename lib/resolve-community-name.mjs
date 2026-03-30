/**
 * resolve-community-name.mjs
 *
 * Shared utility: given a raw community name from a website/API/Sheet,
 * find the canonical name already stored in the DB for that builder.
 *
 * Logic:
 *   Strip noise words common to all builder names (at, by, in, the,
 *   collection, homes, neighborhood, etc.) from both the raw name and
 *   every existing DB community name for that builder.
 *   If any unique token overlaps → it's the same community → return DB name.
 *   No match → new community → cache and return raw name.
 *
 * Example:
 *   raw: "Toll Brothers at Great Park Neighborhoods - Alder Collection"
 *   db:  "Alder (GPN)"
 *   unique tokens: ["alder"]  →  match  →  returns "Alder (GPN)"
 */

// Words that appear in community names across builders but carry no identity.
// Keep this list generic — don't add builder-specific words here.
const NOISE = new Set([
  "at", "by", "in", "the", "of", "and", "a", "an",
  "homes", "home", "community", "communities", "new", "collection",
  "residential", "properties", "living", "neighborhood", "neighborhoods",
  "ranch", "village", "park", "ridge", "grove", "hills", "heights",
  "estates", "place", "square", "commons", "crossing", "landing",
  "pointe", "point", "vista", "summit", "terrace", "garden", "gardens",
])

// Per-builder cache: builderName → string[]
const _cache = {}

/**
 * @param {string}      rawName     Community name from website / API / Sheet
 * @param {string}      builderName Builder name (e.g. "Toll Brothers", "Lennar")
 * @param {PrismaClient} prisma
 * @returns {Promise<string>}       Canonical DB name, or rawName if new
 */
export async function resolveDbCommunityName(rawName, builderName, prisma) {
  // Populate cache once per builder per process run
  if (!_cache[builderName]) {
    const builder = await prisma.builder.findFirst({
      where: { name: { contains: builderName, mode: "insensitive" } },
    })
    const comms = builder
      ? await prisma.community.findMany({
          where: { builderId: builder.id },
          select: { name: true },
        })
      : []
    _cache[builderName] = comms.map(c => c.name)
  }

  const rawTokens = uniqueTokens(rawName)
  if (rawTokens.length === 0) return rawName

  for (const dbName of _cache[builderName]) {
    const dbTokens = uniqueTokens(dbName)
    if (rawTokens.some(t => dbTokens.includes(t))) return dbName
  }

  // New community — add to cache so subsequent communities in same run don't conflict
  _cache[builderName].push(rawName)
  return rawName
}

function uniqueTokens(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !NOISE.has(t))
}
