/**
 * Shared types for all map readers.
 */

export interface MapLot {
  lotNumber: string
  status: "active" | "sold" | "future"
  price?: number
  address?: string
  floorPlan?: string
  beds?: number
  baths?: number
  sqft?: number
}

export interface MapResult {
  sold: number
  forSale: number
  future: number
  total: number
  lots?: MapLot[]
}
