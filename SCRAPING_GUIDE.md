# NewHome Tracker — Scraping Guide

Lessons learned from scraping all current builders. Follow these rules for any new or updated scrapers.

---

## General Rules (Apply to ALL Builders)

### 1. Always Try JSON First
Before DOM scraping, check for embedded data in `<script>` tags:
```js
const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent);
// Look for: __NEXT_DATA__, window.__initialState__, window.communitySearch,
//           availableHomes, homeSites, qmiHomes, inventoryData
const nextData = scripts.find(s => s.includes('__NEXT_DATA__'));
if (nextData) {
  const json = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
  // TRI Pointe, Taylor Morrison, many modern builders use Next.js
}
```

### 2. Use `domcontentloaded`, NOT `networkidle`
`networkidle` frequently times out (60s+). Always use:
```js
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500); // brief pause for dynamic content
```

### 3. Address Cleaning
Strip street suffixes. Use this regex:
```js
function cleanAddress(raw) {
  if (!raw) return null;
  return raw
    .replace(/,.*$/, '')
    .replace(/\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|Path|Pass)\b\.?/gi, '')
    .replace(/\s+/g, ' ').trim();
}
// Always validate: if (!addr || !/^\d/.test(addr)) skip — must start with a number
```

### 4. Always Compute pricePerSqft
The DB does NOT auto-compute it. Always set it on create/update:
```js
const pricePerSqft = (price && sqft) ? Math.round(price / sqft) : null;
```

### 5. Excluded Builders
Always skip these — never create listings for them:
```js
const EXCLUDED_BUILDERS = ['Bonanni Development', 'City Ventures'];
```

### 6. Orange County Only
Only include communities in Orange County, CA.
- If a builder has LA County / Bay Area / Central Valley communities, skip them.
- Verify city is in OC before creating a community.

### 7. Supabase Table/Column Names (camelCase)
Prisma generates PascalCase table names and camelCase columns:
- Table: `Listing` (NOT `listings`)
- Columns: `currentPrice`, `hoaFees`, `moveInDate`, `floorPlan`, `lotNumber`, `sourceUrl`
- Join syntax: `community:Community(name,city,builder:Builder(name))`

### 8. Upsert Pattern
Always check for existing listing before creating:
```js
const existing = await prisma.listing.findFirst({
  where: { communityId: community.id, address: addr }
});
if (existing) {
  await prisma.listing.update({ where: { id: existing.id }, data: { ...updates } });
} else {
  const listing = await prisma.listing.create({ data: { ...newData, status: 'active' } });
  if (price) await prisma.priceHistory.create({
    data: { listingId: listing.id, price, changeType: 'initial' }
  });
}
```

### 9. Mark Removed Listings
After each scrape, mark any DB-active listings NOT found in the current scrape:
```js
const scrapedAddresses = new Set(homes.map(h => h.address));
const dbListings = await prisma.listing.findMany({ where: { communityId, status: 'active' } });
for (const l of dbListings) {
  if (!scrapedAddresses.has(l.address)) {
    await prisma.listing.update({ where: { id: l.id }, data: { status: 'removed', soldAt: new Date() } });
  }
}
```

---

## Builder-Specific Patterns

### Pulte Homes & Del Webb (same company — Pulte Group)
**API**: `https://www.pulte.com/api/plan/qmiplans?communityId=XXXXX`
**Del Webb**: `https://www.delwebb.com/api/plan/qmiplans?communityId=XXXXX`

- Must warm up browser first (visit a community page to get cookies)
- Address comes as JSON object — extract `street1.trim()`:
  ```js
  const addrObj = home?.address;
  const address = addrObj?.street1?.trim() || addrObj?.street || home?.streetAddress || null;
  ```
- Key fields: `price`, `bedrooms`, `bathrooms`, `squareFeet`, `floors`, `garages`, `dateAvailable` (moveIn), `planName`, `lotBlock` (lot), `inventoryPageURL` (sourceUrl)
- For detail page info (HOA, schools): visit `https://www.pulte.com` + `inventoryPageURL`
- Community IDs are in the URL: `.../community-name-XXXXXX` → `communityId=XXXXXX`
- Arden/Eclipse type communities may return empty array (no QMI yet) — that's normal

### Lennar
- No public API — requires full Playwright scraping
- HOA found on community page (not individual listing pages)
- Tax rate: confirmed 1.4% for OC communities → `Math.round(price * 0.014)`
- Community pages: `/homes/california/orange-county/irvine/COMMUNITY-NAME/`
- Individual home URLs contain homesite number

### Toll Brothers
- Community pages list available homes
- No internal API found — scrape DOM
- Price sometimes shows "From $X" — extract the number

### KB Home
- OC URL pattern: `https://www.kbhome.com/new-homes-orange-county/COMMUNITY-NAME`
- Move-in ready homes: `/new-homes-orange-county/COMMUNITY/mir?homesite=XXXXXXX`
- **Plan name fix**: KB shows "Plan 1643 Modeled" → extract just the number: `"1643"`
  ```js
  const planNum = floorPlan?.match(/Plan\s+(\d+)/i)?.[1] || floorPlan;
  ```
- HOA is NOT published on KB website — leave null
- Floor count not directly available on listing pages

### Taylor Morrison
- Next.js site — embedded JSON in `<script id="__NEXT_DATA__">` tag
- Available homes page: `/ca/COMMUNITY/available-homes`
- JSON structure: `pageProps.community.availableHomes` or similar
- OC communities all have `floors=2`
- Parse JSON before any DOM scraping

### TRI Pointe Homes
- Next.js site with `__NEXT_DATA__`
- Community pages: `https://www.tripointehomes.com/ca/orange-county/COMMUNITY-SLUG/`
- Homesite map shows individual lot data (address, price, plan, beds/baths/garages)
- Available homes API-like structure — look for homesite array in `__NEXT_DATA__`
- Plan-level listings (no real address) = not useful; only use homesites with real addresses
- Schools for RMV communities: `Esencia Tk-8 Elementary | Esencia Tk-8 Middle | Tesoro High School`

### Shea Homes
- QMI homes tab URL: `https://www.sheahomes.com/community/SLUG/?qmi-tab-select#available-homes`
- Target: `section.quick-move-in`
- Home card links: `a.home-card_content-title[href*=homesite]`
- Walk up the DOM to find the card container with sqft/beds/price

### Melia Homes
- Site is slow — use `domcontentloaded` + explicit scroll to trigger lazy load
- Community pages redirect to `/new-homes/ca/CITY/COMMUNITY-SLUG/`
- **Timeout issue**: `networkidle` always times out — use `domcontentloaded`
- Individual detail pages have HOA, floors, garages, sqft — always visit them
- Detail page URL from community listing links

### Brookfield Residential
- Only include ORANGE COUNTY communities (not LA County, Bay Area etc.)
- Check OC page: `https://www.brookfieldresidential.com/new-homes/california/orange-county/`
- Current OC community: Vista in Summit Collection, Irvine (Orchard Hills)

---

## Workflow Template

```js
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const prisma = new PrismaClient();
const EXCLUDED_BUILDERS = ['Bonanni Development', 'City Ventures'];

async function main() {
  const builder = await prisma.builder.findFirst({ where: { name: 'Builder Name' } });
  if (!builder) { console.log('Builder not found'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Warm up if needed (Pulte/DelWebb)
  // await page.goto('https://www.buildersite.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  for (const comm of COMMUNITIES) {
    const community = await prisma.community.upsert({
      where: { builderId_name: { builderId: builder.id, name: comm.name } },
      create: { builderId: builder.id, name: comm.name, city: comm.city, state: 'CA', url: comm.url },
      update: { city: comm.city, url: comm.url }
    });

    const homes = await scrapeHomes(page, comm);
    console.log(`  ${comm.name}: ${homes.length} homes found`);

    const scrapedAddresses = new Set();

    for (const h of homes) {
      const addr = cleanAddress(h.address);
      if (!addr || !/^\d/.test(addr)) continue;
      scrapedAddresses.add(addr);

      const price = parsePrice(h.price);
      const pricePerSqft = (price && h.sqft) ? Math.round(price / h.sqft) : null;

      const existing = await prisma.listing.findFirst({
        where: { communityId: community.id, address: addr }
      });

      if (existing) {
        await prisma.listing.update({ where: { id: existing.id }, data: {
          currentPrice: price, pricePerSqft, beds: h.beds, baths: h.baths,
          sqft: h.sqft, floors: h.floors, hoaFees: h.hoa, moveInDate: h.moveIn,
          floorPlan: h.plan, lotNumber: h.lot ? String(h.lot) : null,
          garages: h.garages, status: 'active'
        }});
      } else {
        const listing = await prisma.listing.create({ data: {
          communityId: community.id, address: addr, currentPrice: price, pricePerSqft,
          beds: h.beds, baths: h.baths, sqft: h.sqft, floors: h.floors,
          hoaFees: h.hoa, moveInDate: h.moveIn, floorPlan: h.plan,
          lotNumber: h.lot ? String(h.lot) : null, garages: h.garages,
          status: 'active', sourceUrl: h.sourceUrl || comm.url
        }});
        if (price) await prisma.priceHistory.create({
          data: { listingId: listing.id, price, changeType: 'initial' }
        });
      }
    }

    // Mark removed
    const dbListings = await prisma.listing.findMany({
      where: { communityId: community.id, status: 'active' }
    });
    for (const l of dbListings) {
      if (!scrapedAddresses.has(l.address)) {
        await prisma.listing.update({ where: { id: l.id }, data: { status: 'removed', soldAt: new Date() } });
        console.log(`    Removed: ${l.address}`);
      }
    }
  }

  await browser.close();
  await prisma.$disconnect();
}

function parsePrice(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') return raw;
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n === 0 ? null : n;
}

main().catch(e => { console.error(e); process.exit(1); });
```

---

## Adding a New Builder Checklist

1. **Research**: Find the builder's OC page, identify all OC communities
2. **Check for API**: Look for XHR requests in browser DevTools (Network tab, filter XHR/Fetch)
3. **Check for JSON**: Look for `__NEXT_DATA__`, embedded JSON in `<script>` tags
4. **Identify community IDs**: Often in the URL slug at the end (e.g. `-211549`)
5. **Map fields**: `address`, `price`, `beds`, `baths`, `sqft`, `floors`, `garages`, `hoa`, `moveInDate`, `planName`, `lotNumber`, `sourceUrl`
6. **Add to `builder-colors.ts`**: Brand color for the new builder
7. **Add to excluded builders check** if needed (non-OC)
8. **Test with 1 community** before running all
9. **Verify addresses** start with a number before inserting
10. **Run `pricePerSqft` computation** after insert if not computed during scrape
