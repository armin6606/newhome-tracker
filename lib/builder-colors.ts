const COLORS = [
  "#1B4FA8", "#C9940A", "#E31837", "#2D7D46", "#C4372A",
  "#F16523", "#006BA6", "#9B1B30", "#7B3F9E", "#B71C1C",
]

const cache: Record<string, string> = {}

export function getBuilderColor(builderName: string): string {
  if (cache[builderName]) return cache[builderName]
  let hash = 0
  for (let i = 0; i < builderName.length; i++) hash = builderName.charCodeAt(i) + ((hash << 5) - hash)
  cache[builderName] = COLORS[Math.abs(hash) % COLORS.length]
  return cache[builderName]
}
