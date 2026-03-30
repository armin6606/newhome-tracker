# New Key — Claude Instructions

## ⛔ TIER 1 — NEVER VIOLATE (re-read before every action)

1. **Address format**: Street number + street name ONLY. No suffix (St, Rd, Dr, Ave, Ln, etc). No city. Title case. → `108 Palisades` ✅ `108 Palisades Lane, Irvine` ❌
2. **Community name**: ALWAYS use exact name from Google Sheet Table 1 Column A. Never the raw API/website name. → `Elm Collection` ✅ `Toll Brothers at Great Park - Elm Collection` ❌
3. **Listing ID (lotNumber)**: `communityName.replace(/\s+/g,"") + String(rawLot)`. Example: "Isla at Luna Park" + lot 42 → `IslaatLunaPark42`. Placeholder lots (`sold-N`, `avail-N`, `future-N`) keep their raw format — NO prefix.
4. **Missing fields fallback**: When ANY field is blank (beds, baths, sqft, floors, type, HOA, tax, schools) → ALWAYS use Google Sheet Table 3. Hardcode into COMMUNITIES config. Never fetch from builder API. Applies to ALL 10 builders.
9. **No price = future**: If a real home (with a real address) has no price on the builder site, it must NOT be stored as `active`. Ingest as `future` instead. Applies to ALL 10 builders. When a price later appears, the scraper updates status to `active`. **Retroactive**: any `active` listing with a real address and `currentPrice = null` must be updated to `future`. **Exception**: placeholder lots (`avail-N`, `sold-N`, `future-N`) have no price by design — do NOT apply this rule to them.
5. **Listing status changes**: ONLY the 1 AM scraper can change status, based on builder map observation. NEVER change status from Table 2. Table 2 = display counts only.
6. **New communities**: MANUAL ONLY. Never auto-create. 1 AM scraper uses `strict: true` — rejects unknown communities.
7. **Scrapers read ONLY from Google Sheet**: No hardcoded URLs. No auto-discovery. No following links. Only Table 1 URLs.
8. **No dev server**: Never run `npm run dev` or `preview_start` unless explicitly asked.

## ⚠️ TIER 2 — IMPORTANT RULES

- **Lot counts**: Community card numbers (Sold/For Sale/Future/Total) ALWAYS from Google Sheet Table 2. Never builder API.
- **Duplicate detection**: Always cross-community. Normalize addresses (strip suffixes, city, lowercase). Keep the listing with more data, delete the other. Run after every ghost merge/backfill/ingest.
- **Ghost communities**: If found, immediately move listings to correct community and delete the ghost. Check after every backfill/migration/ingest.
- **Placeholder lots**: `avail-N`, `sold-N`, `future-N` → never show on listings page (already filtered in `/api/listings`).
- **Sales pace display**: "{X} sold in the past {N} days/months". Days if <30, months if ≥30. Only counts **real listings** (`address !== null`) with a `soldAt` date — never placeholder lots (`sold-N` etc.).
- **Sold bar chart rule**: X-axis = one bar per day, starting March 27, 2026 through today (UTC). Each bar counts **real listings only** (`address !== null` — excludes all placeholder lots like `sold-N`) with a `soldAt` timestamp falling within that calendar day (midnight-to-midnight UTC). Label format: `M/D` (e.g. `3/27`). Applies to ALL communities. Stored in `salesByWeek[]` array on the community object.
- **Community tab**: Only show communities with a URL in Table 1 AND ≥1 listing.
- **Ingest is instant**: POST to `/api/ingest` is live immediately. 1 AM scrapers are for detection only.

## 🕐 1 AM Scraper — Exactly 4 Checks Per Community

1. For-Sale → Sold (map shows sold → update status to `sold`)
2. New For Sale (new home on map → add as `active`)
3. Price change (update `currentPrice` + record in `PriceHistory`)
4. Update Table 2 counts (re-sync placeholder lots)

**Never**: create communities, discover new communities, change names/URLs, touch other communities' listings.

## 📧 Daily Report — 6 AM Pacific (Vercel Cron)

- Route: `app/api/cron/daily-report/route.ts`
- Schedule: `"0 13 * * *"` (13:00 UTC = 6 AM PDT)
- To: armin.sabe@gmail.com
- Content: new listings, newly sold, price changes (or "No changes detected")
- "Yesterday" = active listings with `firstDetected < midnight Pacific`
- Never use formula `todayTotal - newCount + soldCount`
- **On startup**: Check if today's report sent. If not, send immediately.

---

## Reference — Project Structure

- **Stack**: Next.js 16 + Prisma + Supabase
- **Live**: https://www.newkey.us | Local: `C:\New Key\`
- **Pages**: `app/` (page.tsx per route)
- **API routes**: `app/api/`
- **DB client**: `lib/db.ts`
- **Schema**: `prisma/schema.prisma`
- **Env vars**: `.env.local`
- **Builder agents**: `Toll Specialist/`, `Lennar Agent/`, `Taylor Morrison Agent/`, `Pulte Agent/`

## Reference — DB Schema

- Builder → Community → Listing → PriceHistory
- Listing unique key: `[communityId, address]`
- Status values: `active`, `sold`, `future`, `removed`
- Placeholder lots: `address=null`, lotNumber like `avail-1`, `sold-1`, `future-1`

## Reference — Google Sheet

- All builders in one spreadsheet: `https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c`
- Fetch by tab: `https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/gviz/tq?tqx=out:csv&sheet=TAB_NAME`
- Tabs: "Toll Communities", "Lennar Communities", "Pulte Communities", "Taylor Communities", "Del Webb Communities", "Shea Communities", "KB Home Communities", "Brookfield Communities", "TriPointe Communities", "Melia Communities"
- Table 2 cols: Community, Sold Homes, For-Sale Homes, Future Release, Total Homes
- Table 3 cols: Community, City, Floorplan, Type, Floors, Sqft, Bedrooms, Bathrooms, Ready By, HOA, Tax, Elementary School, Middle School, High School

## Reference — Deploy Command

```bash
cd "C:/New Key"
vercel --prod --token "$VERCEL_TOKEN" --scope "armin6606s-projects" --yes
vercel alias set <new-deployment-url> www.newkey.us --token "$VERCEL_TOKEN" --scope "armin6606s-projects"
vercel alias set <new-deployment-url> newkey.us --token "$VERCEL_TOKEN" --scope "armin6606s-projects"
```

## Reference — DB Commands

```bash
# Load env then run SQL
cd "C:/New Key" && export $(cat .env.local | grep -v '^#' | xargs) && npx prisma db execute --stdin

# Query via Prisma client
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();..."
```

## Reference — Ingest Endpoint

```
POST https://www.newkey.us/api/ingest
Header: x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0
```

## Reference — Scheduled Tasks

- Toll Brothers: Windows Task Scheduler → "NewKey - Toll Brothers Scraper" → 1:00 AM daily → `C:\New Key\Toll Specialist\scripts\run-scraper.bat`
- Lennar: Windows Task Scheduler → "NewKey Lennar Scraper" → 1:00 AM daily → `C:\New Key\Lennar Agent\scripts\run-scraper.bat`

## What NOT To Do

- No `npm run dev` or `preview_start` unless asked
- No `notReleasedLots` from Toll Brothers API (inflated)
- No placeholder lots on listings page
- No auto-creating communities
- No changing listing status from Table 2
