const EXTERIOR_STYLES =
  /\s+(contemporary|mid[-\s]century|modern farmhouse|california modern|modern hacienda|coastal contemporary|contemporary craftsman|modern|tuscan|craftsman|traditional|colonial|mediterranean|spanish|ranch|prairie|tudor|victorian|farmhouse|cape cod|coastal|transitional|industrial|scandinavian|rustic|urban|shingle|french country|english cottage|italianate|art deco|southwest|adobe|bungalow|georgian|federal|neoclassical|plantation|queenslander|revival|heritage|classic|luxury|new american|american|santa barbara|hacienda|pueblo|craftsman revival)(\s+|$)/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function normalizeFloorPlanName(planName: string | null | undefined, communityName?: string | null): string | null {
  if (!planName) return null

  const original = planName.trim()
  if (!original) return null

  let name = original
    .replace(/\s+/g, " ")
    .replace(/^\s*(plan|residence)\s+/i, "")
    .trim()

  const community = communityName?.trim()
  if (community) {
    const communityVariants = [
      community,
      community.replace(/\([^)]*\)/g, " "),
      community.replace(/\b(collection|at|by|the|homes|home|community|neighborhood|neighborhoods)\b/gi, " "),
    ]
      .flatMap((value) => {
        const cleaned = value.replace(/\s+/g, " ").trim()
        const firstWord = cleaned.split(/\s+/)[0]
        return [cleaned, cleaned.replace(/\s+/g, ""), firstWord]
      })
      .filter(Boolean)

    for (const variant of [...new Set(communityVariants)]) {
      name = name.replace(new RegExp(`^${escapeRegExp(variant)}\\s+`, "i"), "").trim()
    }

    const compactCommunity = compactName(community)
    const compactPlan = compactName(name)
    if (compactCommunity && compactPlan.startsWith(compactCommunity)) {
      name = name.slice(community.length).trim()
    }
  }

  name = name.replace(/^\s*(plan|residence)\s+/i, "").trim()

  let previous = ""
  while (previous !== name) {
    previous = name
    name = name.replace(EXTERIOR_STYLES, " ").replace(/\s+/g, " ").trim()
  }

  const numeric = name.match(/^(\d+)([A-Za-z]*)\b/)
  if (numeric) {
    return numeric[1] + (/x/i.test(numeric[2]) ? "X" : "")
  }

  return name || original
}

export function displayFloorPlanName(planName: string | null | undefined, communityName?: string | null): string {
  return normalizeFloorPlanName(planName, communityName) ?? "-"
}
