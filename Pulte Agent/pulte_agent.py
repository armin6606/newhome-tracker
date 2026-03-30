"""
Pulte Agent — polls Google Sheet for new community URLs, scrapes Pulte website,
writes data back to sheet (Tables 2 & 3), and POSTs to New Key ingest endpoint.
"""

import asyncio
import json
import logging
import re
import time
from pathlib import Path

import gspread
import requests
from google.oauth2.service_account import Credentials
from playwright.async_api import async_playwright, Page, BrowserContext

# ─────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────
SPREADSHEET_ID   = "1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c"
SHEET_NAME       = "Pulte Communities"
INGEST_URL       = "https://www.newkey.us/api/ingest"
INGEST_SECRET    = "xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0"
POLL_INTERVAL    = 300          # seconds between sheet checks
STATE_FILE       = Path(__file__).parent / "processed_urls.json"
CREDS_FILE       = Path(__file__).parent / "service_account.json"

# Sheet row/col indices (1-based for gspread)
T1_DATA_START_ROW = 3          # Table 1 data starts at row 3
T1_COL_NAME       = 1          # Column A
T1_COL_URL        = 2          # Column B

T2_COL_NAME       = 4          # Column D
T2_COL_SOLD       = 5          # Column E
T2_COL_FOR_SALE   = 6          # Column F
T2_COL_FUTURE     = 7          # Column G
T2_COL_TOTAL      = 8          # Column H

T3_HEADER_ROW     = 15         # Row 15 = Table 3 headers
T3_DATA_START_ROW = 16         # Row 16 = first data row
T3_COLS = [
    "Community", "City", "Floorplan", "Type", "Floors",
    "Sqft", "Bedrooms", "Bathrooms", "Ready By",
    "HOA", "Tax", "Elementary School", "Middle School", "High School"
]

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

# ─────────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(Path(__file__).parent / "pulte_agent.log"),
    ],
)
log = logging.getLogger("pulte_agent")


# ─────────────────────────────────────────────
#  STATE (track which URLs have been processed)
# ─────────────────────────────────────────────
def load_state() -> set:
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_state(processed: set) -> None:
    STATE_FILE.write_text(json.dumps(sorted(processed), indent=2))


# ─────────────────────────────────────────────
#  GOOGLE SHEETS
# ─────────────────────────────────────────────
def get_sheet() -> gspread.Worksheet:
    creds = Credentials.from_service_account_file(str(CREDS_FILE), scopes=SCOPES)
    gc    = gspread.authorize(creds)
    return gc.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)


def read_table1(ws: gspread.Worksheet) -> list[dict]:
    """Return list of {row, name, url} for all Table 1 entries."""
    all_vals = ws.get_all_values()
    entries  = []
    for i, row in enumerate(all_vals[T1_DATA_START_ROW - 1:], start=T1_DATA_START_ROW):
        name = (row[T1_COL_NAME - 1] if len(row) >= T1_COL_NAME else "").strip()
        url  = (row[T1_COL_URL  - 1] if len(row) >= T1_COL_URL  else "").strip()
        if name and url and url.startswith("http"):
            entries.append({"row": i, "name": name, "url": url})
    return entries


def write_table2(ws: gspread.Worksheet, row: int, name: str, sold: int,
                 for_sale: int, future: int, total: int) -> None:
    """Write lot counts into Table 2 at the given sheet row."""
    ws.update_cell(row, T2_COL_NAME,     name)
    ws.update_cell(row, T2_COL_SOLD,     sold)
    ws.update_cell(row, T2_COL_FOR_SALE, for_sale)
    ws.update_cell(row, T2_COL_FUTURE,   future)
    ws.update_cell(row, T2_COL_TOTAL,    total)
    log.info("  Table 2 written: sold=%d for_sale=%d future=%d total=%d", sold, for_sale, future, total)


def write_table3_rows(ws: gspread.Worksheet, community_name: str,
                      plans: list[dict]) -> None:
    """Append floor plan rows to Table 3, after the last occupied row."""
    if not plans:
        return
    all_vals = ws.get_all_values()
    # Find the last occupied row in Table 3 (col A = community name)
    last_used = T3_DATA_START_ROW - 1
    for i, row in enumerate(all_vals[T3_HEADER_ROW - 1:], start=T3_HEADER_ROW):
        if row and row[0].strip():
            last_used = i
    next_row = last_used + 1

    rows_to_write = []
    for p in plans:
        rows_to_write.append([
            community_name,
            p.get("city", ""),
            p.get("floorplan", ""),
            p.get("type", ""),
            p.get("floors", ""),
            p.get("sqft", ""),
            p.get("beds", ""),
            p.get("baths", ""),
            p.get("ready_by", ""),
            p.get("hoa", ""),
            p.get("tax", ""),
            p.get("elem_school", ""),
            p.get("mid_school", ""),
            p.get("high_school", ""),
        ])

    end_row = next_row + len(rows_to_write) - 1
    cell_range = f"A{next_row}:N{end_row}"
    ws.update(cell_range, rows_to_write)
    log.info("  Table 3: wrote %d floor plan rows starting at row %d", len(rows_to_write), next_row)


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────
def parse_price(text: str) -> int | None:
    """'$1,605,168' → 1605168"""
    if not text:
        return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def parse_number(text: str) -> float | None:
    """'3.5' or '3' from a string, None if empty."""
    if not text:
        return None
    m = re.search(r"[\d.]+", text)
    return float(m.group()) if m else None


def strip_address_suffix(addr: str) -> str:
    """'123 Maple Street, Irvine' → '123 Maple'"""
    suffixes = (
        r"\b(Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|Boulevard|Blvd|"
        r"Court|Ct|Place|Pl|Road|Rd|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Loop|Run|"
        r"Path|Pass|Alley|Aly|Row|Walk)\b.*"
    )
    city_suffix = r",\s*.+"
    addr = re.sub(city_suffix, "", addr)
    addr = re.sub(suffixes, "", addr, flags=re.IGNORECASE)
    return addr.strip().rstrip(",").strip()


# ─────────────────────────────────────────────
#  SCRAPING — COMMUNITY OVERVIEW
# ─────────────────────────────────────────────
async def scrape_overview(page: Page) -> dict:
    """Extract community metadata from the overview page."""
    data = {}

    # JSON-LD structured data (most reliable)
    ld_scripts = await page.query_selector_all('script[type="application/ld+json"]')
    for s in ld_scripts:
        try:
            raw  = await s.inner_text()
            obj  = json.loads(raw)
            if isinstance(obj, dict) and obj.get("@type") == "HomeAndConstructionBusiness":
                addr = obj.get("address", {})
                data["name"]   = obj.get("name", "")
                data["city"]   = addr.get("addressLocality", "")
                data["state"]  = addr.get("addressRegion", "")
                data["zip"]    = addr.get("postalCode", "")
                data["street"] = addr.get("streetAddress", "")
                data["description"] = obj.get("description", "")
                break
        except Exception:
            pass

    # Price + type from the stats block
    try:
        stats_el = await page.query_selector(".CommunityOverview__home-stats")
        if stats_el:
            stats_text = await stats_el.inner_text()
            price_m = re.search(r"\$([\d,]+)", stats_text)
            if price_m:
                data["base_price"] = parse_price(price_m.group(0))
            sqft_m = re.search(r"([\d,]+)\s*-\s*([\d,]+)\s*sqft", stats_text, re.IGNORECASE)
            if sqft_m:
                data["sqft_min"] = int(sqft_m.group(1).replace(",", ""))
                data["sqft_max"] = int(sqft_m.group(2).replace(",", ""))
            type_m = re.search(r"(Condominium|Single Family|Townhome|Villa|Multi-Family)", stats_text, re.IGNORECASE)
            if type_m:
                data["property_type"] = type_m.group(1)
    except Exception as e:
        log.warning("  overview stats parse error: %s", e)

    # Schools
    try:
        school_links = await page.query_selector_all('[class*="school"] a, [class*="School"] a')
        schools = []
        for lnk in school_links:
            txt = (await lnk.inner_text()).strip()
            if txt and txt not in schools:
                schools.append(txt)
        if len(schools) >= 1:
            data["elem_school"] = schools[0]
        if len(schools) >= 2:
            data["mid_school"]  = schools[1]
        if len(schools) >= 3:
            data["high_school"] = schools[2]
    except Exception:
        pass

    log.info("  Overview: name=%s city=%s state=%s", data.get("name"), data.get("city"), data.get("state"))
    return data


# ─────────────────────────────────────────────
#  SCRAPING — FLOOR PLANS (Homes tab)
# ─────────────────────────────────────────────
async def scrape_plans(page: Page, overview: dict) -> list[dict]:
    """Scrape floor plan cards from #HomeDesignFilter."""
    plans = []

    # Scroll through the whole page to trigger lazy-loading of plan cards
    try:
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
        await page.wait_for_timeout(1000)
        await page.evaluate("document.getElementById('HomeDesignFilter')?.scrollIntoView({behavior:'instant'})")
        await page.wait_for_timeout(2500)
    except Exception:
        pass

    # Try waiting for plan card element to appear
    try:
        await page.wait_for_selector('.plan-summary-gallery, [class*="planSummary"], .info__header', timeout=8000)
    except Exception:
        log.warning("  Plan cards did not appear — page may still be loading")

    # Primary: find plan name anchors (very reliable — always present for each plan)
    plan_anchors = await page.query_selector_all('.plan-summary-gallery .info__header a')
    if not plan_anchors:
        plan_anchors = await page.query_selector_all('[class*="info__header"] a[href*="plan"]')
    if not plan_anchors:
        # Broad fallback: any anchor whose text matches "Plan N"
        all_anchors = await page.query_selector_all('a')
        plan_anchors = []
        for a in all_anchors:
            txt = (await a.inner_text()).strip()
            if re.match(r'^Plan\s+\d+$', txt, re.IGNORECASE):
                plan_anchors.append(a)

    # Deduplicate anchors by plan name (page may render duplicates for mobile/desktop)
    seen_names = set()
    unique_anchors = []
    for a in plan_anchors:
        txt = (await a.inner_text()).strip()
        if txt and txt not in seen_names:
            seen_names.add(txt)
            unique_anchors.append(a)

    for anchor in unique_anchors:
        try:
            plan_name = (await anchor.inner_text()).strip()
            # Walk up to the plan card container
            container = await anchor.evaluate_handle(
                "el => el.closest('.plan-summary-gallery') || el.parentElement?.parentElement?.parentElement?.parentElement"
            )
            plan = {"floorplan": plan_name}

            full_text = await container.inner_text() if container else ""

            # Price
            price_m = re.search(r"\$([\d,]+)", full_text)
            if price_m:
                plan["price"] = parse_price(price_m.group(0))

            # Sqft — take first number before "Sq. Ft."
            sqft_m = re.search(r"([\d,]+)\s*Sq\.\s*Ft\.", full_text, re.IGNORECASE)
            if sqft_m:
                plan["sqft"] = int(sqft_m.group(1).replace(",", ""))

            # Beds
            beds_m = re.search(r"([\d][\d\-]*)\s*Beds?", full_text, re.IGNORECASE)
            if beds_m:
                plan["beds"] = beds_m.group(1)

            # Baths
            baths_m = re.search(r"([\d.]+)\s*Baths?", full_text, re.IGNORECASE)
            if baths_m:
                plan["baths"] = float(baths_m.group(1))

            # Floors/Stories
            floors_m = re.search(r"(\d+)\s*Stor(?:y|ies)", full_text, re.IGNORECASE)
            if floors_m:
                plan["floors"] = int(floors_m.group(1))

            # Ready-by date
            date_m = re.search(
                r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}\b",
                full_text, re.IGNORECASE
            )
            if date_m:
                plan["ready_by"] = date_m.group(0)

            plan["type"]        = overview.get("property_type", "")
            plan["city"]        = overview.get("city", "")
            plan["elem_school"] = overview.get("elem_school", "")
            plan["mid_school"]  = overview.get("mid_school", "")
            plan["high_school"] = overview.get("high_school", "")

            plans.append(plan)
        except Exception as e:
            log.debug("  Plan parse error: %s", e)

    # Fallback to original stat_blocks approach if no plans found via anchors
    if not plans:
        stat_blocks = await page.query_selector_all(
            ".CompareResults__contentContainer.stats-wrapper.plan-card-override"
        )
        if not stat_blocks:
            stat_blocks = await page.query_selector_all('[class*="stats-wrapper"][class*="plan-card"]')

        for block in stat_blocks:
            try:
                container = await block.evaluate_handle(
                    "el => el.closest('.plan-summary-gallery, [class*=\"planItem\"], article') || el.parentElement.parentElement.parentElement"
                )
                plan = {}

                name_el = await container.query_selector('.info__header a, [class*="info__header"] a')
                if name_el:
                    plan["floorplan"] = (await name_el.inner_text()).strip()

                price_el = await container.query_selector('[class*="price"], [class*="Price"]')
                if price_el:
                    plan["price"] = parse_price((await price_el.inner_text()).strip())

                stats_text = (await block.inner_text()).strip()
                if re.search(r"Lot\s*#\s*(\d+)", stats_text, re.IGNORECASE):
                    continue  # skip QMI individual homes in plan fallback

                sqft_m  = re.search(r"([\d,]+)\s*Sq\.\s*Ft\.", stats_text, re.IGNORECASE)
                beds_m  = re.search(r"([\d\-–]+)\s*Beds?", stats_text, re.IGNORECASE)
                baths_m = re.search(r"([\d.]+)\s*Baths?", stats_text, re.IGNORECASE)
                floor_m = re.search(r"(\d+)\s*Stor(?:y|ies)", stats_text, re.IGNORECASE)
                if sqft_m:  plan["sqft"]   = int(sqft_m.group(1).replace(",", ""))
                if beds_m:  plan["beds"]   = beds_m.group(1)
                if baths_m: plan["baths"]  = float(baths_m.group(1))
                if floor_m: plan["floors"] = int(floor_m.group(1))

                full_text = (await container.inner_text()).strip() if container else ""
                date_m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}\b", full_text, re.IGNORECASE)
                if date_m: plan["ready_by"] = date_m.group(0)

                plan["type"]        = overview.get("property_type", "")
                plan["city"]        = overview.get("city", "")
                plan["elem_school"] = overview.get("elem_school", "")
                plan["mid_school"]  = overview.get("mid_school", "")
                plan["high_school"] = overview.get("high_school", "")

                if plan.get("floorplan"):
                    plans.append(plan)
            except Exception as e:
                log.debug("  Plan parse error: %s", e)

    # De-duplicate by floorplan name (keep first occurrence — the plan-level entry, not QMI)
    seen = {}
    deduped = []
    for p in plans:
        key = p.get("floorplan", "")
        if key not in seen:
            seen[key] = True
            deduped.append(p)

    log.info("  Plans scraped: %d unique floor plans", len(deduped))
    return deduped


# ─────────────────────────────────────────────
#  SCRAPING — QMI HOMES (Quick Move-In)
# ─────────────────────────────────────────────
async def scrape_qmi(page: Page, overview: dict) -> list[dict]:
    """Scrape Quick Move-In homes (homes with specific lot numbers + addresses)."""
    qmi_homes = []

    try:
        # Try to click the QMI tab but don't block if it's not visible
        try:
            qmi_tab = await page.query_selector('button:has-text("Quick Move-In"), a:has-text("Quick Move-In")')
            if qmi_tab and await qmi_tab.is_visible():
                await qmi_tab.click(timeout=5000)
                await page.wait_for_timeout(1000)
        except Exception:
            pass  # QMI tab not available or not clickable — scan DOM directly

        stat_blocks = await page.query_selector_all(
            ".CompareResults__contentContainer.stats-wrapper.plan-card-override"
        )
        for block in stat_blocks:
            stats_text = (await block.inner_text()).strip()
            lot_m = re.search(r"Lot\s*#\s*(\d+)", stats_text, re.IGNORECASE)
            if not lot_m:
                continue  # Only QMI homes have a lot number visible

            container = await block.evaluate_handle(
                "el => el.closest('.plan-summary-gallery, article') || el.parentElement.parentElement.parentElement"
            )
            home = {}
            home["lot_number"] = lot_m.group(1).lstrip("0") or lot_m.group(1)

            # Plan name
            name_el = await container.query_selector('.info__header a')
            if name_el:
                home["floorplan"] = (await name_el.inner_text()).strip()

            # Price
            price_el = await container.query_selector('[class*="price"]')
            if price_el:
                home["price"] = parse_price((await price_el.inner_text()).strip())

            # Specs
            sqft_m  = re.search(r"([\d,]+)\s*Sq\.", stats_text)
            beds_m  = re.search(r"([\d]+)\s*Beds?", stats_text, re.IGNORECASE)
            baths_m = re.search(r"([\d.]+)\s*Baths?", stats_text, re.IGNORECASE)
            story_m = re.search(r"(\d+)\s*Stor", stats_text, re.IGNORECASE)
            if sqft_m:
                home["sqft"]   = int(sqft_m.group(1).replace(",", ""))
            if beds_m:
                home["beds"]   = int(beds_m.group(1))
            if baths_m:
                home["baths"]  = float(baths_m.group(1))
            if story_m:
                home["floors"] = int(story_m.group(1))

            # Address — only set if a real short street address is found
            full_text = (await container.inner_text()).strip() if container else ""
            addr_m = re.search(
                r"\b(\d{1,6}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})"
                r"(?:\s+(?:Street|St|Way|Lane|Ln|Circle|Cir|Drive|Dr|Avenue|Ave|"
                r"Blvd|Boulevard|Court|Ct|Place|Pl|Road|Rd|Loop|Run|Path|Parkway|Pkwy))\b",
                full_text
            )
            if addr_m:
                raw_addr = addr_m.group(0).strip()
                if len(raw_addr) < 80:
                    home["address"] = strip_address_suffix(raw_addr)

            # Ready by date
            date_m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}\b", full_text, re.IGNORECASE)
            if date_m:
                home["ready_by"] = date_m.group(0)

            home["type"]        = overview.get("property_type", "")
            home["city"]        = overview.get("city", "")
            home["elem_school"] = overview.get("elem_school", "")
            home["mid_school"]  = overview.get("mid_school", "")
            home["high_school"] = overview.get("high_school", "")

            qmi_homes.append(home)
    except Exception as e:
        log.warning("  QMI scrape error: %s", e)

    log.info("  QMI homes found: %d", len(qmi_homes))
    return qmi_homes


# ─────────────────────────────────────────────
#  SCRAPING — HOMESITE MAP (AlphaVision)
# ─────────────────────────────────────────────
async def scrape_map(page: Page, context: BrowserContext) -> dict:
    """
    Count lots from the AlphaVision homesite map.
    Strategy:
      1. Intercept all JSON responses while the map loads — look for lot/homesite data.
      2. If an API response contains lot data, parse it directly (most reliable).
      3. Fall back to iframe DOM parsing if API intercept yields nothing.
    Returns: {"total": N, "sold": N, "for_sale": N, "future": N}
    """
    lot_data  = []
    api_found = asyncio.Event()

    # Keywords that indicate a lot-data API response
    LOT_KEYWORDS = re.compile(
        r'"(?:lotNumber|homesite|HomeSite|lot_number|lotNum|LotNum|'
        r'lotStatus|LotStatus|status|Status)"', re.IGNORECASE
    )

    async def handle_response(response):
        try:
            url = response.url
            ct  = response.headers.get("content-type", "")
            if "json" not in ct:
                return
            if not any(kw in url for kw in ["lot", "homesite", "alpha", "community", "plan", "inventory"]):
                return
            body = await response.json()
            raw  = json.dumps(body)
            if LOT_KEYWORDS.search(raw):
                lot_data.append(body)
                api_found.set()
                log.info("  Map API hit: %s", url)
        except Exception:
            pass

    page.on("response", handle_response)

    # Scroll to map section to trigger iframe load
    try:
        await page.evaluate(
            "document.getElementById('AlphaVisionMapIframe')?.scrollIntoView({behavior:'instant'})"
        )
        await page.wait_for_timeout(3000)
    except Exception:
        pass

    # Wait up to 8 seconds for an API response
    try:
        await asyncio.wait_for(api_found.wait(), timeout=8)
    except asyncio.TimeoutError:
        log.info("  No map API response intercepted — trying iframe DOM.")

    page.remove_listener("response", handle_response)

    # ── Parse API data if found ──────────────────────────────────────────
    if lot_data:
        return _parse_lot_api(lot_data)

    # ── Fallback: read iframe DOM directly ───────────────────────────────
    return await _parse_iframe_dom(page)


def _parse_lot_api(responses: list) -> dict:
    """Parse intercepted JSON responses to count lots."""
    total = sold = for_sale = 0

    for resp in responses:
        # Normalise to a flat list of lot objects
        lots = _flatten_lots(resp)
        for lot in lots:
            status = (
                lot.get("status") or lot.get("lotStatus") or
                lot.get("Status") or lot.get("LotStatus") or ""
            ).lower()
            price = (
                lot.get("price") or lot.get("Price") or
                lot.get("listPrice") or lot.get("currentPrice") or 0
            )
            try:
                price = float(str(price).replace(",", "").replace("$", "")) if price else 0
            except ValueError:
                price = 0

            total += 1
            if "sold" in status or "contract" in status or "closed" in status:
                sold += 1
            elif price > 0 or "available" in status or "active" in status or "for_sale" in status:
                for_sale += 1

    future = max(0, total - sold - for_sale)
    return {"total": total, "sold": sold, "for_sale": for_sale, "future": future}


def _flatten_lots(obj) -> list:
    """Recursively find any list of dicts that looks like lot records."""
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict):
            keys = set(obj[0].keys())
            if keys & {"lotNumber", "homesite", "lot_number", "lotNum", "status", "Status"}:
                return obj
        # Recurse into nested lists
        for item in obj:
            result = _flatten_lots(item)
            if result:
                return result
    elif isinstance(obj, dict):
        for val in obj.values():
            result = _flatten_lots(val)
            if result:
                return result
    return []


async def _parse_iframe_dom(page: Page) -> dict:
    """
    Last-resort: navigate to the AlphaVision iframe src in a new page
    and count lots by their visual classes in the DOM.
    """
    total = sold = for_sale = 0

    try:
        iframe_src = await page.evaluate("""
            () => {
                const container = document.getElementById('AlphaVisionMapIframe');
                const iframe = container?.querySelector('iframe');
                return iframe ? iframe.src : null;
            }
        """)
        if not iframe_src:
            log.warning("  Could not find AlphaVision iframe src.")
            return {"total": 0, "sold": 0, "for_sale": 0, "future": 0}

        log.info("  Opening AlphaVision iframe: %s", iframe_src[:80])
        av_page = await page.context.new_page()
        await av_page.goto(iframe_src, wait_until="networkidle", timeout=20000)
        await av_page.wait_for_timeout(3000)

        # Count lot elements — common AlphaVision DOM patterns
        all_lots = await av_page.query_selector_all(
            '[class*="lot"], [class*="homesite"], [class*="pin"], [data-lot], [data-homesite]'
        )
        total = len(all_lots)

        sold_lots = await av_page.query_selector_all(
            '[class*="sold"], [class*="Sold"], [class*="closed"], [class*="Closed"]'
        )
        sold = len(sold_lots)

        avail_lots = await av_page.query_selector_all(
            '[class*="available"], [class*="Available"], [class*="active"], [class*="for-sale"]'
        )
        for_sale = len(avail_lots)

        if total == 0 and sold == 0 and for_sale == 0:
            # Try extracting text content — look for price patterns on lot elements
            page_text = await av_page.inner_text("body")
            total    = len(re.findall(r'\bLot\s*#?\s*\d+\b', page_text, re.IGNORECASE))
            for_sale = len(re.findall(r'\$\d[\d,]+', page_text))

        await av_page.close()

    except Exception as e:
        log.warning("  iframe DOM parse error: %s", e)

    future = max(0, total - sold - for_sale)
    log.info("  Map counts (iframe DOM): total=%d sold=%d for_sale=%d future=%d", total, sold, for_sale, future)
    return {"total": total, "sold": sold, "for_sale": for_sale, "future": future}


# ─────────────────────────────────────────────
#  INGEST API
# ─────────────────────────────────────────────
def _parse_beds(val) -> float | None:
    """Convert beds value to float. '3-4' → 3.0, '3' → 3.0, 3 → 3.0"""
    if val is None:
        return None
    s = str(val).strip()
    m = re.match(r"(\d+)", s)  # take the first (lower) number
    return float(m.group(1)) if m else None


def build_listings(plans: list[dict], qmi_homes: list[dict],
                   map_counts: dict, community_url: str) -> list[dict]:
    """Build the listings array for the ingest payload."""
    listings = []

    # Real QMI homes first (they count toward active/for_sale)
    for h in qmi_homes:
        beds  = _parse_beds(h.get("beds"))
        baths = h.get("baths")
        sqft  = h.get("sqft")
        price = h.get("price")
        listing = {
            "lotNumber":    h.get("lot_number") or None,
            "floorPlan":    h.get("floorplan") or None,
            "beds":         beds,
            "baths":        float(baths) if baths is not None else None,
            "sqft":         int(sqft)  if sqft  is not None else None,
            "floors":       int(h["floors"]) if h.get("floors") is not None else None,
            "garages":      int(h["garage"]) if h.get("garage") is not None else None,
            "propertyType": h.get("type") or None,
            "moveInDate":   h.get("ready_by") or None,
            "status":       "active",
            "sourceUrl":    community_url,
        }
        if price:
            listing["currentPrice"] = int(price)
            if sqft and price:
                listing["pricePerSqft"] = round(price / sqft)
        if h.get("address"):
            listing["address"] = h["address"]
        # Remove None values
        listing = {k: v for k, v in listing.items() if v is not None}
        listings.append(listing)

    # Placeholder lots for remaining counts
    sold_count    = map_counts.get("sold",     0)
    for_sale_count = map_counts.get("for_sale", 0)
    future_count  = map_counts.get("future",   0)

    real_active = len(qmi_homes)
    remaining_active = max(0, for_sale_count - real_active)

    for i in range(1, sold_count + 1):
        listings.append({"lotNumber": f"sold-{i}", "status": "sold"})

    for i in range(1, remaining_active + 1):
        listings.append({"lotNumber": f"avail-{i}", "status": "active"})

    for i in range(1, future_count + 1):
        listings.append({"lotNumber": f"future-{i}", "status": "future"})

    return listings


def post_to_ingest(community_name: str, community_url: str,
                   overview: dict, listings: list[dict]) -> bool:
    state_abbr = {
        "California": "CA", "Texas": "TX", "Florida": "FL",
        "Georgia": "GA", "Arizona": "AZ", "Nevada": "NV",
        "Colorado": "CO", "North Carolina": "NC", "Tennessee": "TN",
    }
    state_raw = overview.get("state", "")
    state = state_abbr.get(state_raw, state_raw[:2].upper() if state_raw else "")

    payload = {
        "builder": {
            "name":       "Pulte",
            "websiteUrl": "https://www.pulte.com",
        },
        "community": {
            "name":  community_name,
            "city":  overview.get("city", ""),
            "state": state,
            "url":   community_url,
        },
        "listings": listings,
    }

    try:
        resp = requests.post(
            INGEST_URL,
            json=payload,
            headers={
                "x-ingest-secret": INGEST_SECRET,
                "Content-Type":    "application/json",
            },
            timeout=30,
        )
        if resp.status_code in (200, 201, 204):
            log.info("  Ingest POST success: %s (%d listings)", community_name, len(listings))
            return True
        else:
            log.error("  Ingest POST failed %d: %s", resp.status_code, resp.text[:800])
            log.debug("  Payload sent: %s", json.dumps(payload, indent=2)[:1000])
            return False
    except Exception as e:
        log.error("  Ingest POST exception: %s", e)
        return False


# ─────────────────────────────────────────────
#  MAIN COMMUNITY PROCESSOR
# ─────────────────────────────────────────────
async def process_community(browser_context: BrowserContext,
                             ws: gspread.Worksheet,
                             entry: dict) -> bool:
    """Full pipeline for one community URL."""
    name = entry["name"]
    url  = entry["url"]
    row  = entry["row"]
    log.info("Processing: %s → %s", name, url)

    page = await browser_context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        # 1. Overview
        overview = await scrape_overview(page)

        # 2. Floor plans
        plans = await scrape_plans(page, overview)

        # 3. QMI homes
        qmi = await scrape_qmi(page, overview)

        # 4. Map lot counts
        map_counts = await scrape_map(page, browser_context)

        # 5. Write Table 2
        write_table2(
            ws, row, name,
            sold     = map_counts["sold"],
            for_sale = map_counts["for_sale"],
            future   = map_counts["future"],
            total    = map_counts["total"],
        )

        # 6. Write Table 3 (unique floor plans only, not QMI duplicates)
        write_table3_rows(ws, name, plans)

        # 7. Build and POST ingest payload
        listings = build_listings(plans, qmi, map_counts, url)
        post_to_ingest(name, url, overview, listings)

        return True
    except Exception as e:
        log.error("  Failed to process %s: %s", name, e, exc_info=True)
        return False
    finally:
        await page.close()


# ─────────────────────────────────────────────
#  POLLING LOOP
# ─────────────────────────────────────────────
async def run_agent():
    log.info("Pulte Agent started. Polling every %ds.", POLL_INTERVAL)
    processed = load_state()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )

        while True:
            try:
                ws      = get_sheet()
                entries = read_table1(ws)
                new_urls = [e for e in entries if e["url"] not in processed]

                if new_urls:
                    log.info("Found %d new URL(s) to process.", len(new_urls))
                    for entry in new_urls:
                        success = await process_community(context, ws, entry)
                        if success:
                            processed.add(entry["url"])
                            save_state(processed)
                else:
                    log.info("No new URLs. Next check in %ds.", POLL_INTERVAL)

            except gspread.exceptions.APIError as e:
                log.warning("Google Sheets API error: %s", e)
            except Exception as e:
                log.error("Polling error: %s", e, exc_info=True)

            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(run_agent())
