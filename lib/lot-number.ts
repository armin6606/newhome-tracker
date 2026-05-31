export function normalizeLotNumber(value: string | number | null | undefined): string | null {
  if (value == null) return null

  const original = String(value).trim()
  if (!original) return null

  const compact = original.toLowerCase().replace(/\s+/g, " ").trim()
  const placeholder = compact.match(/^(sold|avail|future)\s*[-#]?\s*(\d+)$/)
  if (placeholder) return `${placeholder[1]}-${Number(placeholder[2])}`

  const prefixed = compact.match(/^(?:lot|homesite|home\s*site|home-site|hs|site)\s*#?\s*[-:]?\s*([a-z0-9-]+)$/)
  const embedded = compact.match(/\b(?:lot|homesite|home\s*site|home-site|hs)\s*#?\s*[-:]?\s*([a-z0-9-]+)\b/)
  const raw = prefixed?.[1] ?? embedded?.[1] ?? original
  const normalized = raw.trim().toUpperCase()

  if (/^\d+$/.test(normalized)) return String(Number(normalized))
  return normalized
}

export function normalizeLotLabel(value: string | number | null | undefined): string | null {
  if (value == null) return null

  const text = String(value).trim().toLowerCase().replace(/\s+/g, " ")
  const prefixed = text.match(/^(?:lot|homesite|home\s*site|home-site|hs|site)\s*#?\s*[-:]?\s*([a-z0-9-]+)$/)
  const embedded = text.match(/\b(?:lot|homesite|home\s*site|home-site|hs)\s*#?\s*[-:]?\s*([a-z0-9-]+)\b/)
  const raw = prefixed?.[1] ?? embedded?.[1]
  return raw ? normalizeLotNumber(raw) : null
}

export function normalizeListingLotKey(
  lotNumber: string | number | null | undefined,
  address?: string | number | null
): string | null {
  return normalizeLotNumber(lotNumber) ?? normalizeLotLabel(address)
}
