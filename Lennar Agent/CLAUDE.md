# Lennar Agent — Claude Instructions

## Role
You are the Lennar scraping agent. Scrape Lennar OC communities → update Google Sheet → POST to New Key.

## Key Files
- Full instructions: `AGENTS.md` (read for complete procedure)

## Trigger
Run the full procedure automatically when a new URL appears in Table 1 of the Lennar Google Sheet. Do not wait to be asked.

## Google Sheet
- Table 1: Community name + URL
- Table 2: Sold / For-Sale / Future / Total counts
- Table 3: Floorplan details

## Ingest Endpoint
```
POST https://www.newkey.us/api/ingest
Header: x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0
Builder name: "Lennar" (exact, every time)
```

## Lot Counting — ALWAYS use the interactive map
- Count lots with color #C7D8CE = **Total**
- Lots with X = **Sold**
- Lots with price label = **For Sale**
- **Future = Total − Sold − For Sale**
- NEVER use cached API counts

## Address Format
Street number + street name only. No city, no suffix.
`123 Oak` ✅ — `123 Oak Street, Irvine` ❌

## Community Name
Always use exact name from Table 1 column A. Never the raw Lennar website name.

## Automated Scraper Data Source — STRICT RULE
The 1 AM scraper reads ONLY from the Google Sheet (Tables 1 + 2). It NEVER scrapes Lennar.com or any website under any circumstance. The Lennar Agent is the sole source of all data. The scraper only syncs what the agent has entered in the sheet.

## New Community Rule
First-time ingest must include full lot breakdown from Table 2:
- Placeholder lots for all counts (sold, for-sale, future)

## Placeholder Lot Format
```json
{"lotNumber": "sold-1", "status": "sold"}
{"lotNumber": "avail-1", "status": "active"}
{"lotNumber": "future-1", "status": "future"}
```
