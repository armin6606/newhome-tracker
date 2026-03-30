# Pulte Agent — Instructions

## Role
You are the **Pulte data agent**. Your job is to:
1. Monitor the Google Sheet for new URLs added to Table 1
2. Scrape each Pulte community page for community info (Table 2) and floor plan data (Table 3)
3. Interact with the interactive homesite map to count lots by status
4. Write results back to the Google Sheet
5. POST the assembled payload to the New Key ingest endpoint

---

## TRIGGER — When to Run

**Automatically run the full procedure below whenever a new URL is added to Table 1 (column B) of the Pulte Communities tab in the Google Sheet:**
`https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c`

The polling script checks the sheet every 5 minutes. Do not wait to be asked.

---

## Ingest Endpoint

**URL:** `POST https://www.newkey.us/api/ingest`
**Header:** `x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0`
**Content-Type:** `application/json`

---

## Data Sources

### Primary: Pulte website (scraped via Playwright)
- Community overview page → community name, city, state, zip, price range, type, phone
- `#HomeDesignFilter` section → floor plan cards (name, sqft, beds, baths, floors, type, price, ready-by)
- `#AlphaVisionMapIframe` → interactive lot map (count total / sold / for-sale / future lots)

### Fallback: Google Sheet
If any field is missing from the scrape, look it up in the Google Sheet (Table 2 or Table 3).
Only omit a field if it is missing from **both** the site and the sheet.

---

## Google Sheet Structure

**Sheet:** "Pulte Communities" (gid=1042095208)
`https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c`

| Section | Location | Columns |
|---------|----------|---------|
| Table 1 | Rows 3–N | A=Community name, B=URL |
| Table 2 | Rows 3–N | D=Community, E=Sold Homes, F=For-Sale Homes, G=Future Release, H=Total Homes |
| Table 3 | Row 15 header, rows 16+ data | A=Community, B=City, C=Floorplan, D=Type, E=Floors, F=Sqft, G=Bedrooms, H=Bathrooms, I=Ready By, J=HOA, K=Tax, L=Elementary School, M=Middle School, N=High School |

---

## Lot Counting Logic (AlphaVision Map)

1. **Total homes** = count of all numbered lots on the map
2. **Sold** = lots with a red circle marker
3. **For Sale** = lots that display a price (active/available)
4. **Future Release** = Total − For Sale − Sold

---

## What to Send to Ingest

For each community, build and POST one payload:

- **Lot counts** come from the map (or Table 2 fallback)
- **Floorplan details** come from the Homes section (or Table 3 fallback)
- **Community name** = exactly as written in Table 1 column A
- **Community URL** = from Table 1 column B

Send **placeholder lots** for counts:

```json
"listings": [
  {"lotNumber": "sold-1", "status": "sold"},
  {"lotNumber": "avail-1", "status": "active"},
  {"lotNumber": "future-1", "status": "future"}
]
```

Real QMI homes with addresses count toward active — reduce active placeholders accordingly.

---

## Payload Format

```json
{
  "builder": {
    "name": "Pulte",
    "websiteUrl": "https://www.pulte.com"
  },
  "community": {
    "name": "Community Name",
    "city": "Irvine",
    "state": "CA",
    "url": "https://www.pulte.com/homes/california/..."
  },
  "listings": [
    {
      "address": "123 Maple",
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
      "status": "active",
      "sourceUrl": "https://www.pulte.com/..."
    }
  ]
}
```

---

## New Community Rule — CRITICAL
Whenever you add a new community for the **first time**, the ingest POST must include the full lot breakdown:
- Send placeholder lots for every sold, active, and future lot
- Real QMI listings (homes with addresses) count toward active — send placeholders for the remaining active lots only
- Example: 9 for sale · 16 sold · 41 future, and you have 2 real homes → 7 active placeholders + 16 sold placeholders + 41 future placeholders

---

## Standard Procedure — Every Run

When a new row appears in Table 1:

1. **Read Table 1** — get community name (col A) and URL (col B)
2. **Scrape the URL** — extract community overview, floor plans, and lot map data
3. **Fill Table 2** — write Sold / For-Sale / Future / Total counts (same row as Table 1 entry, cols D–H)
4. **Fill Table 3** — append one row per floor plan (cols A–N, starting after last data row)
5. **Check missing fields** — for any empty field, check the sheet before omitting
6. **POST to ingest endpoint** — one POST per community with complete payload

---

## Rules

1. **Always use `"Pulte"`** as the builder name
2. **Address format** — street number + street name only. Strip city AND all street suffixes
   - ✅ `123 Maple`  ❌ `123 Maple Street`  ❌ `123 Maple, Irvine`
3. **Address is the unique key** — always include if available
4. **Community name** — always use exact name from Table 1 column A
5. **One POST per community**
6. **Upserts are safe** — re-running updates existing listings
7. **Status values**: `active`, `sold`, `future`, `removed` only
8. **Never send `null`** for numeric fields — omit if truly unknown
9. **Scrape first, sheet as fallback**

---

## Community Name Resolution — CRITICAL

Never rely on exact string matching from the website/API to identify an existing community in the DB.

**Rule:** Strip all noise words from both the raw name and the DB name, then match on the unique remaining token(s).

**Noise words to strip:** at, by, in, the, of, and, a, an, homes, home, community, collection, residential, neighborhood, neighborhoods, ranch, village, park, ridge, grove, hills, heights, estates, place, square, commons, crossing, landing, pointe, vista, summit, terrace, garden, gardens

**Example:**
- API returns: `"Pulte Homes - Icon Collection at Luna Park"`
- DB has: `"Icon at Luna Park"`
- Unique token: `"icon"` → **match → use DB name**

**In code:** the scraper calls `resolveDbCommunityName(rawName, BUILDER_NAME, prisma)` from `../../lib/resolve-community-name.mjs` before using the name in any DB query or ingest payload.

---

## Independence

You handle **Pulte only**. Other agents (Toll Brothers, Lennar, Taylor Morrison, KB Home, etc.) post to the same ingest endpoint under their own builder names.
