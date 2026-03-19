/**
 * Brand-inspired colors for each builder.
 * Used consistently across listings, communities, and detail pages.
 */
const BUILDER_COLORS: Record<string, string> = {
  "Lennar":                "#1B4FA8", // Lennar blue
  "Toll Brothers":         "#C9940A", // Toll Brothers gold
  "KB Home":               "#E31837", // KB Home red
  "TRI Pointe Homes":      "#2D7D46", // TRI Pointe forest green
  "Shea Homes":            "#C4372A", // Shea red
  "Pulte Homes":           "#F16523", // Pulte orange
  "Del Webb":              "#006BA6", // Del Webb sky blue
  "Taylor Morrison":       "#9B1B30", // Taylor Morrison burgundy
  "Risewell Homes":        "#009688", // Risewell teal
  "Melia Homes":           "#7B3F9E", // Melia purple
  "Brookfield Residential":"#B71C1C", // Brookfield dark red
  "City Ventures":         "#D4760D", // City Ventures amber
  "Brandywine Homes":      "#8D6E63", // Brandywine brown
  "Olson Homes":           "#558B2F", // Olson olive green
  "Bonanni Development":   "#4527A0", // Bonanni deep purple
  "Baldwin & Sons":        "#2C5F6E", // Baldwin teal-slate
  "NWHM":                  "#009688", // same as Risewell (same company)
}

/**
 * Returns the hex color string for a given builder name.
 * Falls back to a neutral gray for unknown builders.
 */
export function getBuilderColor(name: string): string {
  // Try exact match first
  if (BUILDER_COLORS[name]) return BUILDER_COLORS[name]
  // Try partial match (handles "Lennar Homes" etc.)
  for (const [key, color] of Object.entries(BUILDER_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(name.toLowerCase())) {
      return color
    }
  }
  return "#78716C" // stone-500 fallback
}

/**
 * Returns a Tailwind font-weight class + inline color style object.
 * Usage: <span className="font-semibold" style={builderStyle(name)}>
 */
export function builderStyle(name: string): React.CSSProperties {
  return { color: getBuilderColor(name) }
}
