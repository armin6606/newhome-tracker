/**
 * del-webb-map.ts
 *
 * Del Webb uses the same AlphaVision iframe as Pulte.
 * Re-exports readPulteMap with a Del Webb-specific log prefix.
 */

import { chromium } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult } from "./types"

// Del Webb and Pulte share the same PulteGroup infrastructure and AlphaVision maps.
// We import the same logic but label logs as [DelWebb].

import { readPulteMap } from "./pulte-map"

export async function readDelWebbMap(
  url: string,
  communityName: string
): Promise<MapResult> {
  // Delegate to Pulte map reader — identical AlphaVision infrastructure
  console.log(`[DelWebb] Delegating to Pulte AlphaVision reader for: ${communityName}`)
  return readPulteMap(url, communityName)
}
