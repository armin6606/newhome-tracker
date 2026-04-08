# New Key — Absolute Rules

> These rules are EXACT and NON-NEGOTIABLE.
> Do NOT interpret, modify, improve, or skip any rule.
> If you cannot follow a rule, return ERROR and stop.
> Do NOT guess. Do NOT infer. Do NOT hallucinate values.

---

## ⛔ TIER 1 — HARD RULES (violation = immediate stop)

### Rule 1 — Address Format
**MUST:** Street number + street name ONLY.
**MUST NOT:** Include city, state, zip, or street suffix.
**MUST NOT:** Use floorplan names as addresses (Plan 1, Lot 3, Residence 2, etc.).
**MUST:** Title case. Strip: St, Rd, Dr, Ave, Ln, Way, Blvd, Ct, Pl, Ter, Trl, Pkwy, Loop, Run, Path, Pass, Alley, Circle, Court.

✅ VALID: `108 Palisades`
❌ INVALID: `108 Palisades Lane` `108 Palisades, Irvine` `Plan 1` `Lot 22`

If address fails validation → **skip listing, log to rejected[]**.

---

### Rule 2 — Community Name
**MUST:** Use EXACT name from Google Sheet Table 1 Column A.
**MUST NOT:** Use raw API/website name, builder prefix, or any variation.

✅ VALID: `Elm Collection`
❌ INVALID: `Toll Brothers at Great Park Neighborhoods - Elm Collection`

If community name not found in DB → **reject entire request, return ERROR**.

---

### Rule 3 — Listing ID Format
**MUST:** `communityName.replace(/\s+/g,"") + String(rawLot)`
**MUST:** Placeholder lots keep raw format — NO community prefix.

✅ VALID: `IslaatLunaPark42`, `sold-1`, `avail-3`, `future-7`
❌ INVALID: `IslaatLunaPark-sold-1`

---

### Rule 4 — Missing Fields
**MUST:** When ANY field is missing (beds, baths, sqft, floors, type, HOA, tax, schools) → use Google Sheet Table 3.
**MUST NOT:** Fetch from builder API for missing fields.
**MUST NOT:** Leave fields null when Table 3 has the value.

---

### Rule 5 — Listing Status Values
**MUST:** Status MUST be one of exactly: `active` `sold` `future` `removed`
**MUST NOT:** Use any other value (`limited`, `pending`, `available`, etc.).

If status is invalid → **skip listing, log to rejected[]**.

---

### Rule 6 — No Price = Future
**MUST:** Real listing (has address) + `status=active` + `currentPrice=null` → force status to `future`.
**MUST NOT:** Store no-price real listings as `active`.
**EXCEPTION:** Placeholder lots (`avail-N`) have no price by design — do NOT apply this rule.

---

### Rule 7 — Status Changes (Scraper Only)
**MUST:** Only the 1 AM scraper may change listing status, based on builder map observation.
**MUST NOT:** Change status from Table 2 data.
**MUST NOT:** Change status manually via ingest without scraper detection.

---

### Rule 8 — New Communities
**MUST NOT:** Auto-create communities via ingest. New communities = manual only.
**MUST:** Reject any ingest where community does not exist in DB.

---

### Rule 9 — Scrapers Read Only From Google Sheet
**MUST:** Use only Table 1 URLs from the Google Sheet.
**MUST NOT:** Hardcode builder URLs.
**MUST NOT:** Auto-discover or follow links.

---

### Rule 10 — No Dev Server
**MUST NOT:** Run `npm run dev` or `preview_start` unless explicitly asked by user.

---

## ⚠️ TIER 2 — ENFORCED RULES

### Lot Counts (Community Cards)
**MUST:** Sold / For Sale / Future / Total counts come from Google Sheet Table 2.
**MUST NOT:** Use builder API counts.
**MUST NOT:** Use real listing counts for community cards.

### Sold Bar Chart
**MUST:** One bar per day, starting March 27, 2026 through today (UTC).
**MUST:** Count only real listings (`address !== null`) with `soldAt` in that day.
**MUST NOT:** Count placeholder lots in bar chart.

### Sales Pace Display
**MUST:** Format: `{X} sold in the past {N} days` (days if <30) or `{N} months` (if ≥30).
**MUST:** Count only real listings (`address !== null`) with `soldAt` set.
**MUST NOT:** Count placeholder lots.

### Duplicate Detection
**MUST:** Cross-community. Normalize: strip suffix, city, lowercase.
**MUST:** Keep listing with more data. Delete the other.
**MUST:** Run after every ingest / backfill / migration.

### Placeholder Lots
**MUST NOT:** Show placeholder lots on the listings page.
Format: `avail-N` (active), `sold-N` (sold), `future-N` (future). Address = null.

---

## 📋 INGEST PAYLOAD — EXACT SCHEMA

**Endpoint:** `POST https://www.newkey.us/api/ingest`
**Header:** `x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0`
**Content-Type:** `application/json`

```json
{
  "builder": {
    "name": "Toll Brothers",
    "websiteUrl": "https://www.tollbrothers.com"
  },
  "community": {
    "name": "Elm Collection",
    "city": "Irvine",
    "state": "CA",
    "url": "https://www.tollbrothers.com/elm"
  },
  "listings": [
    {
      "address": "108 Palisades",
      "lotNumber": "ElmCollection108",
      "floorPlan": "Plan 2",
      "sqft": 2100,
      "beds": 3,
      "baths": 2.5,
      "garages": 2,
      "floors": 2,
      "currentPrice": 1618000,
      "propertyType": "Single Family",
      "hoaFees": 250,
      "taxes": 18000,
      "status": "active",
      "sourceUrl": "https://www.tollbrothers.com/elm/108"
    }
  ]
}
```

**MUST:** All field names exactly as shown. Do NOT rename, add, or remove fields.
**MUST:** `status` MUST be one of: `active` `sold` `future` `removed`.
**MUST:** `address` MUST start with a digit OR be null (placeholder only).
**MUST NOT:** Send floorplan names as `address`.

---

## ✅ VALID INGEST RESPONSE SCHEMA

```json
{
  "ok": true,
  "community": "Elm Collection",
  "builder": "Toll Brothers",
  "created": 2,
  "updated": 5,
  "priceChanges": 1,
  "rejected": [
    { "address": "Plan 1", "reason": "Address does not start with a street number" }
  ],
  "autoFixed": [
    { "original": "108 Palisades Lane, Irvine", "address": "108 Palisades", "fix": "address cleaned (suffix/city stripped)" }
  ]
}
```

**MUST:** Check `rejected[]` after every ingest. Log rejected listings.
**MUST:** Check `autoFixed[]` and verify corrections are correct.
**MUST:** If `ok` is false → fix payload before retrying.

---

## ❌ ERROR RESPONSE SCHEMA

```json
{
  "error": "Community \"Bad Name\" does not exist. New communities must be created manually.",
  "knownCommunities": ["Elm Collection", "Alder (GPN)", "Birch"]
}
```

**MUST:** On error → stop. Do NOT retry with same payload. Fix the error first.

---

## 🕐 1 AM SCRAPER — EXACT 4 STEPS (no more, no less)

**Step 1:** For-Sale → Sold — if builder map shows lot as sold → update status to `sold`
**Step 2:** New For Sale — if new lot appears on map → add as `active` (with price) or `future` (no price)
**Step 3:** Price change — if price changed → update `currentPrice`, record in `PriceHistory`
**Step 4:** Sync Table 2 counts — re-sync placeholder lots from Google Sheet Table 2

**MUST NOT:** Create new communities.
**MUST NOT:** Touch listings in other communities.
**MUST NOT:** Change community names or URLs.
**MUST NOT:** Add `active` listings without a price — use `future` instead.

---

## 📧 DAILY REPORT — 6 AM Pacific

- Route: `app/api/cron/daily-report/route.ts`
- Schedule: `"0 13 * * *"` (13:00 UTC = 6 AM PDT)
- To: armin.sabe@gmail.com
- Content: new listings, newly sold, price changes, community card accuracy vs Table 2
- "Yesterday" = listings with `firstDetected < midnight Pacific`

---

## 🔢 GOOGLE SHEET REFERENCE

**Sheet ID:** `1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c`

| Tab Name | Builder |
|----------|---------|
| Toll Communities | Toll Brothers |
| Lennar Communities | Lennar |
| Pulte Communities | Pulte |
| Taylor Communities | Taylor Morrison |
| Del Webb Communities | Del Webb |
| Shea Communities | Shea Homes |
| KB Home Communities | KB Home |
| Brookfield Communities | Brookfield |
| TriPointe Communities | TRI Pointe Homes |
| Melia Communities | Melia Homes |

**Table 2 columns:** Community, Sold Homes, For-Sale Homes, Future Release, Total Homes
**Table 3 columns:** Community, City, Floorplan, Type, Floors, Sqft, Bedrooms, Bathrooms, Ready By, HOA, Tax, Elementary School, Middle School, High School

**Fetch CSV:** `https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/export?format=csv&gid=GID`

---

## 🗄️ DB SCHEMA REFERENCE

```
Builder → Community → Listing → PriceHistory
Listing unique key: [communityId, address]
Status values: active | sold | future | removed
Placeholder: address=null, lotNumber=avail-N|sold-N|future-N
```

---

## 🚀 DEPLOY COMMAND

```bash
cd "C:/New Key"
vercel --prod --token "$VERCEL_TOKEN" --scope "armin6606s-projects" --yes
vercel alias set <deployment-url> www.newkey.us --token "$VERCEL_TOKEN" --scope "armin6606s-projects"
vercel alias set <deployment-url> newkey.us --token "$VERCEL_TOKEN" --scope "armin6606s-projects"
```

---

## 🗃️ DB COMMANDS

```bash
cd "C:/New Key" && export $(cat .env.local | grep -v '^#' | xargs) && npx prisma db execute --stdin
```

---

## 📅 SCHEDULED TASKS

- Toll Brothers: Windows Task Scheduler → 1:00 AM → `C:\New Key\Toll Specialist\scripts\run-scraper.bat`
- Lennar: Windows Task Scheduler → 1:00 AM → `C:\New Key\Lennar Agent\scripts\run-scraper.bat`
- Shea Homes: Windows Task Scheduler → 1:00 AM → `C:\New Key\Shea Agent\scripts\run-scraper.bat`

---

## 🚫 NEVER DO

- `npm run dev` or `preview_start` unless explicitly asked
- Use `notReleasedLots` from Toll Brothers API (inflated)
- Show placeholder lots on listings page
- Auto-create communities
- Change listing status from Table 2
- Use builder API for community card counts
- Add listings with no price as `active`
- Use floorplan names as addresses
