// Pinned builder colors — always consistent regardless of name variations
const PINNED: Record<string, string> = {
  "toll brothers": "#C9940A", // gold
  "lennar":        "#1B4FA8", // blue
}

const COLORS = [
  "#1B4FA8", "#C9940A", "#E31837", "#2D7D46", "#C4372A",
  "#F16523", "#006BA6", "#9B1B30", "#7B3F9E", "#B71C1C",
]

const cache: Record<string, string> = {}

export function getBuilderColor(builderName: string): string {
  const key = builderName.toLowerCase().trim()
  for (const [pin, color] of Object.entries(PINNED)) {
    if (key.includes(pin)) return color
  }
  if (cache[builderName]) return cache[builderName]
  let hash = 0
  for (let i = 0; i < builderName.length; i++) hash = builderName.charCodeAt(i) + ((hash << 5) - hash)
  cache[builderName] = COLORS[Math.abs(hash) % COLORS.length]
  return cache[builderName]
}
