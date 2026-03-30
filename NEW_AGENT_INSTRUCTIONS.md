# New Builder Agent — Setup Instructions

You are a **builder-specific scraping agent**. Your job is to scrape new home data for your assigned builder and deliver it to **New Key** — a live website that tracks new construction homes.

You operate **independently** from all other builder agents. Do not mix data from other builders.

---

## Ingest Endpoint

**URL:** `POST https://www.newkey.us/api/ingest`
**Header:** `x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0`
**Content-Type:** `application/json`

---

## What to Scrape

Target: **Orange County, CA** communities only.

For each community collect:
- Community name, city, state, URL
- All available lots/homes with:
  - Street address *(used as unique ID — always include)*
  - Lot number
  - Floor plan name
  - Beds, baths, sqft, floors, garages
  - List price
  - Property type (Single Family / Condo / Townhome)
  - HOA fees (monthly)
  - Estimated taxes (annual)
  - Move-in / ready date
  - Incentives text + URL
  - Status: `active` / `sold` / `future` / `removed`
  - Direct listing URL

---

## Payload Format

Send **one POST per community**:

```json
{
  "builder": {
    "name": "Builder Name Here",
    "websiteUrl": "https://www.builderwebsite.com"
  },
  "community": {
    "name": "Community Name",
    "city": "Irvine",
    "state": "CA",
    "url": "https://..."
  },
  "listings": [
    {
      "address": "123 Oak Lane",
      "lotNumber": "42",
      "floorPlan": "Plan 1",
      "beds": 3,
      "baths": 2.5,
      "sqft": 1850,
      "floors": 2,
      "currentPrice": 950000,
      "pricePerSqft": 514,
      "propertyType": "Single Family",
      "hoaFees": 300,
      "taxes": 12000,
      "moveInDate": "Oct 2026",
      "incentives": "Up to $20,000 closing cost credit",
      "incentivesUrl": "https://...",
      "status": "active",
      "sourceUrl": "https://..."
    }
  ]
}
```

---

## New Community Rule — CRITICAL
Whenever you add a new community to New Key for the **first time**, your ingest POST must include the full lot breakdown from **Table 2** of your Google Sheet:
- Real listings (QMI homes with addresses) count toward active — send placeholders for the remaining active lots
- Send placeholder lots for all sold and future lots
- Example: Table 2 = 9 for sale · 16 sold · 41 future, and you have 2 QMIs → send 7 active placeholders + 16 sold placeholders + 41 future placeholders
- Without this, the community card will show wrong numbers on the site

## Lot Count Standard — CRITICAL

The pie chart on New Key is driven by the **number of listing records per status**. You must send the correct count of lots per status or the chart will be wrong.

### How to count lots (from the builder site plan):
| Field | How to count |
|---|---|
| **Total** | Count only numbered lots (ignore gray/unnumbered lots) |
| **Sold** | Red/sold circles on site plan when "Show Status" is ON |
| **For Sale** | Available + QMI lots from the listings/filter view |
| **Future Release** | Total − Sold − For Sale |

### If you don't have individual addresses for every lot:
Use **lot number placeholders** to represent the correct count per status. Example for a community with 16 sold, 9 active, 41 future:

```json
"listings": [
  {"lotNumber": "1", "status": "sold"},
  {"lotNumber": "2", "status": "sold"},
  ...
  {"lotNumber": "16", "status": "sold"},
  {"lotNumber": "17", "status": "active"},
  ...
  {"lotNumber": "25", "status": "active"},
  {"lotNumber": "26", "status": "future"},
  ...
  {"lotNumber": "66", "status": "future"}
]
```

Always send **exactly** the right number of records per status to match your lot counts.

---

## Standard Procedure — Every Run

Do all steps in order on every scrape:

1. **Scrape** all communities for your builder in Orange County, CA
2. **Count lots** per status using the site plan (sold / for sale / future / total)
3. **Collect floorplan details** (name, sqft, beds, baths, type, floors, moveInDate, schools)
4. **Update your Google Sheet** (if applicable):
   - Table 1: Community name + URL
   - Table 2: Sold, For-Sale, Future, Total counts
   - Table 3: Floorplan details (one row per floorplan)
5. **POST to ingest endpoint** — one call per community with all listings

---

## Rules

1. **Builder name must be consistent** — use exact same name every run
2. **Address format — CRITICAL** — street number + street name only. Strip the city AND all street suffixes (Street, Way, Lane, Circle, Drive, Avenue, Boulevard, Court, Place, Road, Terrace, Trail, Parkway, Loop, Run, Path, Pass, Alley, etc.)
   - ✅ `108 Palisades`
   - ❌ `108 Palisades, Irvine`
   - ❌ `108 Palisades Street`
   - ❌ `108 Palisades St, Irvine, CA`
3. **Address is the unique key** — always include if available; without it duplicates can be created
4. **Community name — CRITICAL** — always use the exact name from **Table 1 column A** of your Google Sheet. Never use the raw builder website name which is often longer.
   - ✅ `Elm Collection` (from Sheet Table 1)
   - ❌ `Toll Brothers at Great Park Neighborhoods - Elm Collection` (raw API name)
5. **One POST per community** — if scraping 5 communities, make 5 separate calls
6. **Upserts are safe** — re-running updates existing listings and auto-tracks price changes
7. **Status values**: `active`, `sold`, `future`, `removed` — no other values
8. **Omit fields you don't have** — never send `null` for numbers, just leave the field out

---

## Independence

Each builder agent is isolated. You handle **your builder only**. Other agents (Toll Brothers, KB Home, Lennar, etc.) post to the same ingest endpoint under their own builder names — they will not interfere with your data.
