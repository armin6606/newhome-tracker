/**
 * Playwright-based map reader for Taylor Morrison community pages.
 *
 * Taylor Morrison communities embed a tm-vu site-plan iframe. That iframe
 * loads a Firebase Storage payload with every real lot, including sold and
 * future lots. `/available-homes` is still used only to merge active list
 * prices, because the site-plan payload stores lot premiums in some fields.
 */

import { chromium, type Page } from "playwright"
import { randomDelayMs, randomUserAgent } from "../utils"
import type { MapResult, MapLot } from "./types"

interface TmPayload {
  siteplanName?: string
  site?: { segments?: TmSegment[] }
  floorplans?: TmFloorPlan[]
}

interface TmSegment {
  uid?: string
  lotName?: string
  lotNumber?: string | number
  number?: string | number
  address?: string
  status?: string
  floorplans?: string[]
  readyDate?: number | string
}

interface TmFloorPlan {
  uid?: string
  name?: string
  price?: string | number
  specs?: {
    sqft?: string | number
    bed?: string | number
    bath?: string | number
    halfBath?: string | number
    garage?: string | number
    level?: string | number
  }
}

interface AvailableHomeCard {
  lotNumber?: string
  address?: string
  floorPlan?: string
  price?: number
  beds?: number
  baths?: number
  sqft?: number
  garages?: number
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const normalized = value.replace(/[^0-9.]/g, "")
  if (!normalized) return undefined
  const n = Number(normalized)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parsePrice(value: unknown): number | undefined {
  const n = parseNumber(value)
  return n && n >= 100_000 ? Math.round(n) : undefined
}

function normalizeKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

function parseLotNumber(segment: TmSegment): string | undefined {
  const raw = segment.lotNumber ?? segment.number ?? segment.lotName
  if (raw === undefined || raw === null) return undefined
  const text = String(raw).trim()
  const match = text.match(/(?:lot\s*#?\s*)?([A-Za-z0-9-]+)$/i)
  return match?.[1]
}

async function fetchTmVuPayload(siteplanId: string): Promise<TmPayload | null> {
  const encodedId = encodeURIComponent(siteplanId)
  const metaUrl = `https://firebasestorage.googleapis.com/v0/b/taylor-morrison-vu.appspot.com/o/siteplan%2F${encodedId}%2Fpayload.json`
  const metaRes = await fetch(metaUrl)
  if (!metaRes.ok) return null

  const meta = await metaRes.json().catch(() => null) as { downloadTokens?: string } | null
  const token = meta?.downloadTokens?.split(",")[0]
  const payloadUrl = token
    ? `${metaUrl}?alt=media&token=${encodeURIComponent(token)}`
    : `${metaUrl}?alt=media`

  const payloadRes = await fetch(payloadUrl)
  if (!payloadRes.ok) return null
  return await payloadRes.json().catch(() => null) as TmPayload | null
}

async function extractAvailableHomeCards(page: Page, url: string): Promise<AvailableHomeCard[]> {
  const availableUrl = url.replace(/\/$/, "") + "/available-homes"
  await page.goto(availableUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(randomDelayMs(2000, 4000))

  return await page.evaluate(`(() => {
    const parseNum = (text) => {
      if (!text) return undefined
      const n = Number(String(text).replace(/[^0-9.]/g, ""))
      return Number.isFinite(n) && n > 0 ? n : undefined
    }
    const parsePrice = (text) => {
      const n = parseNum(text)
      return n && n >= 100000 ? Math.round(n) : undefined
    }

    const cards = Array.from(document.querySelectorAll(".tm-home-card"))
    const seen = new Set()
    const results = []

    for (const card of cards) {
      const floorPlan = card.querySelector(".tm-home-card__info--address-fp")?.innerText?.trim() || undefined
      const address = card.querySelector(".tm-home-card__info--address-full")?.innerText?.trim() || undefined
      const priceText = card.querySelector(".tm-home-card__info--price-cur")?.innerText?.trim() || ""
      const lotMatch = card.innerText?.match(/Lot\\s+#?\\s*([A-Za-z0-9-]+)/i)
      const lotNumber = lotMatch?.[1]
      const key = \`\${address ?? ""}|\${lotNumber ?? ""}\`
      if (seen.has(key)) continue
      seen.add(key)

      let beds
      let baths
      let sqft
      let garages

      for (const feat of Array.from(card.querySelectorAll(".tm-home-card__features--item"))) {
        const text = feat.innerText?.trim() || ""
        const lower = text.toLowerCase()
        const num = parseNum(text)
        if (!num) continue
        if (lower.includes("bed")) beds = num
        else if (lower.includes("bath")) baths = num
        else if (lower.includes("sq")) sqft = Math.round(num)
        else if (lower.includes("gar")) garages = num
      }

      results.push({
        lotNumber,
        address,
        floorPlan,
        price: parsePrice(priceText),
        beds,
        baths,
        sqft,
        garages,
      })
    }

    return results
  })()`) as AvailableHomeCard[]
}

function mapTmStatus(status: string | undefined, price: number | undefined): MapLot["status"] {
  const s = (status ?? "").toLowerCase()
  if (s.includes("sold") || s.includes("closed")) return "sold"
  if (s.includes("inventory") || s.includes("available") || s.includes("reserved")) {
    return price ? "for sale" : "future"
  }
  return "future"
}

function buildLotsFromPayload(payload: TmPayload, availableHomes: AvailableHomeCard[], siteplanUrl: string): MapLot[] {
  const floorplansByUid = new Map(
    (payload.floorplans ?? []).filter(fp => fp.uid).map(fp => [fp.uid!, fp])
  )
  const homesByLot = new Map(
    availableHomes.filter(home => home.lotNumber).map(home => [home.lotNumber!, home])
  )
  const homesByAddress = new Map(
    availableHomes.filter(home => home.address).map(home => [normalizeKey(home.address), home])
  )

  return (payload.site?.segments ?? []).flatMap((segment): MapLot[] => {
    const lotNumber = parseLotNumber(segment)
    if (!lotNumber) return []

    const activeCard = homesByLot.get(lotNumber) ?? homesByAddress.get(normalizeKey(segment.address))
    const floorplanUid = segment.floorplans?.[0]
    const floorplan = floorplanUid ? floorplansByUid.get(floorplanUid) : undefined
    const price = activeCard?.price ?? parsePrice(floorplan?.price)
    const status = mapTmStatus(segment.status, price)
    const specs = floorplan?.specs
    const baths = parseNumber(specs?.bath)
    const halfBaths = parseNumber(specs?.halfBath)

    return [{
      lotNumber,
      address: activeCard?.address ?? segment.address,
      floorPlan: activeCard?.floorPlan ?? floorplan?.name,
      price: status === "for sale" ? price : undefined,
      beds: activeCard?.beds ?? parseNumber(specs?.bed),
      baths: activeCard?.baths ?? (baths !== undefined ? baths + (halfBaths ? halfBaths / 2 : 0) : undefined),
      sqft: activeCard?.sqft ?? parseNumber(specs?.sqft),
      floors: parseNumber(specs?.level),
      garages: activeCard?.garages ?? parseNumber(specs?.garage),
      moveInDate: segment.readyDate ? new Date(segment.readyDate).toISOString().slice(0, 10) : undefined,
      sourceUrl: siteplanUrl,
      status,
    }]
  })
}

async function readTmVuLots(page: Page, url: string, communityName: string): Promise<MapResult | null> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(randomDelayMs(4000, 7000))

  const siteplanUrl = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"))
      .map(frame => (frame as HTMLIFrameElement).src)
      .filter(src => src.includes("tm-vu.com/siteplan/"))
    return frames[0] || null
  })

  const siteplanId = siteplanUrl?.match(/\/siteplan\/([^?/#]+)/)?.[1]
  if (!siteplanId) {
    console.log(`[TaylorMorrison] ${communityName}: no tm-vu siteplan iframe found`)
    return null
  }

  const payload = await fetchTmVuPayload(siteplanId)
  const segmentCount = payload?.site?.segments?.length ?? 0
  if (!payload || segmentCount === 0) {
    console.log(`[TaylorMorrison] ${communityName}: tm-vu payload empty for ${siteplanId}`)
    return null
  }

  const availableHomes = await extractAvailableHomeCards(page, url).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[TaylorMorrison] ${communityName}: available-home price merge failed: ${msg}`)
    return [] as AvailableHomeCard[]
  })

  const lots = buildLotsFromPayload(payload, availableHomes, siteplanUrl)
  const sold = lots.filter(l => l.status === "sold").length
  const forSale = lots.filter(l => l.status === "for sale").length
  const future = lots.filter(l => l.status === "future").length
  console.log(`[TaylorMorrison] ${communityName}: tm-vu total=${lots.length} sold=${sold} forSale=${forSale} future=${future}`)

  return { sold, forSale, future, total: lots.length, lots, qmiOnly: false }
}

export async function readTaylorMorrisonMap(
  url: string,
  communityName: string
): Promise<MapResult> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  try {
    const tmVuResult = await readTmVuLots(page, url, communityName)
    if (tmVuResult) return tmVuResult

    const availableUrl = url.replace(/\/$/, "") + "/available-homes"
    console.log(`[TaylorMorrison] Loading fallback: ${availableUrl}`)
    await page.goto(availableUrl, { waitUntil: "networkidle", timeout: 60000 })
    await page.waitForTimeout(randomDelayMs(2000, 4000))

    const cardCount = await page.locator(".tm-home-card").count()
    console.log(`[TaylorMorrison] ${communityName}: ${cardCount} tm-home-card elements`)

    if (cardCount > 0) {
      const rawLots = await extractAvailableHomeCards(page, url)
      const lots: MapLot[] = rawLots
        .filter(raw => raw.lotNumber)
        .map(raw => ({
          lotNumber: raw.lotNumber!,
          address: raw.address,
          floorPlan: raw.floorPlan,
          price: raw.price,
          beds: raw.beds,
          baths: raw.baths,
          sqft: raw.sqft,
          garages: raw.garages,
          status: raw.price ? "for sale" : "future",
        }))

      const forSale = lots.filter(l => l.status === "for sale").length
      const future = lots.filter(l => l.status === "future").length
      console.log(`[TaylorMorrison] ${communityName}: fallback forSale=${forSale} future=${future}`)
      return { sold: 0, forSale, future, total: lots.length, lots, qmiOnly: true }
    }

    console.log(`[TaylorMorrison] ${communityName}: No data found`)
    return { sold: 0, forSale: 0, future: 0, total: 0, lots: [], qmiOnly: true }
  } finally {
    await browser.close()
  }
}
