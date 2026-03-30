"""
One-shot scraper: processes all unprocessed URLs in Pulte Communities sheet right now.
"""
import asyncio, json, re, logging
from pathlib import Path
from playwright.async_api import async_playwright

# ── inline imports from pulte_agent ──────────────────────────────────────────
import sys
sys.path.insert(0, str(Path(__file__).parent))
from pulte_agent import (
    get_sheet, read_table1, write_table2, write_table3_rows,
    scrape_overview, scrape_plans, scrape_qmi, scrape_map,
    build_listings, post_to_ingest,
    load_state, save_state
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger("scrape_now")

async def main():
    processed = load_state()
    ws      = get_sheet()
    entries = read_table1(ws)
    new     = [e for e in entries if e["url"] not in processed]

    if not new:
        log.info("No new URLs to process.")
        return

    log.info("Processing %d communities: %s", len(new), [e['name'] for e in new])

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

        for entry in new:
            name = entry["name"]
            url  = entry["url"]
            row  = entry["row"]
            log.info("=== %s ===", name)

            page = await context.new_page()

            # Intercept map API responses
            lot_data  = []
            api_hit   = asyncio.Event()
            LOT_RE    = re.compile(r'"(?:lotNumber|homesite|lot_number|lotNum|lotStatus|LotStatus)"', re.IGNORECASE)

            async def on_response(resp):
                try:
                    ct = resp.headers.get("content-type","")
                    if "json" not in ct: return
                    u = resp.url.lower()
                    if not any(k in u for k in ["lot","homesite","alpha","inventory","community","plan"]): return
                    body = await resp.json()
                    raw  = json.dumps(body)
                    if LOT_RE.search(raw):
                        lot_data.append(body)
                        api_hit.set()
                        log.info("  MAP API: %s", resp.url[:80])
                except Exception: pass

            page.on("response", on_response)

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(2500)

                overview  = await scrape_overview(page)
                plans     = await scrape_plans(page, overview)
                qmi       = await scrape_qmi(page, overview)

                # Trigger map load
                await page.evaluate("document.getElementById('AlphaVisionMapIframe')?.scrollIntoView({behavior:'instant'})")
                try: await asyncio.wait_for(api_hit.wait(), timeout=8)
                except asyncio.TimeoutError: log.info("  No map API — trying iframe DOM")

                from pulte_agent import _parse_lot_api, _parse_iframe_dom
                map_counts = _parse_lot_api(lot_data) if lot_data else await _parse_iframe_dom(page)

                log.info("  OVERVIEW : %s", overview)
                log.info("  PLANS    : %d plans — %s", len(plans), [p.get('floorplan') for p in plans])
                log.info("  QMI      : %d homes", len(qmi))
                log.info("  MAP      : %s", map_counts)

                write_table2(ws, row, name,
                    sold=map_counts["sold"], for_sale=map_counts["for_sale"],
                    future=map_counts["future"], total=map_counts["total"])

                write_table3_rows(ws, name, plans)

                listings = build_listings(plans, qmi, map_counts, url)
                post_to_ingest(name, url, overview, listings)

                processed.add(url)
                save_state(processed)

            except Exception as e:
                log.error("  ERROR: %s", e, exc_info=True)
            finally:
                page.remove_listener("response", on_response)
                await page.close()

        await browser.close()

    log.info("Done.")

asyncio.run(main())
