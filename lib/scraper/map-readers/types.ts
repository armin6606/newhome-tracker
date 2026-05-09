/**
 * Shared types for all map readers.
 */

export interface MapLot {
  lotNumber: string
  status: "for sale" | "sold" | "future"
  price?: number
  address?: string
  floorPlan?: string
  beds?: number
  baths?: number
  sqft?: number
  floors?: number
  garages?: number
  moveInDate?: string
}

export interface MapResult {
  sold: number
  forSale: number
  future: number
  total: number
  lots?: MapLot[]
  /** Community is completely sold out — all remaining active/future lots should be marked sold */
  soldOut?: boolean
  /** Only QMI (for-sale) homes were scraped — bypass the 50% lot-count safety guard */
  qmiOnly?: boolean
}
