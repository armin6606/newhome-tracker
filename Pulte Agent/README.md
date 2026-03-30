# Pulte Agent — Setup & Usage

## What it does
Polls the "Pulte Communities" tab in the Google Sheet every 5 minutes.
When a new URL is added to **Table 1**, it:
1. Scrapes the Pulte community page (overview + floor plans + homesite map)
2. Writes lot counts to **Table 2** (cols D–H, same row as the URL)
3. Writes floor plan rows to **Table 3** (appended after row 15)
4. POSTs the full payload to `https://www.newkey.us/api/ingest`

---

## One-time Setup

### 1. Install dependencies
```bash
cd "C:\New Key\Pulte Agent"
pip install -r requirements.txt
playwright install chromium
```

### 2. Google Sheets service account
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable **Google Sheets API** and **Google Drive API**
3. Create a **Service Account** → generate a JSON key
4. Save the JSON key as `C:\New Key\Pulte Agent\service_account.json`
5. Share the spreadsheet with the service account email (give **Editor** access)

The `service_account.json` file looks like:
```json
{
  "type": "service_account",
  "project_id": "...",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "pulte-agent@your-project.iam.gserviceaccount.com",
  ...
}
```

---

## Running the agent

```bash
cd "C:\New Key\Pulte Agent"
python pulte_agent.py
```

The agent runs continuously. Logs go to:
- Console (stdout)
- `pulte_agent.log` (same folder)

Processed URLs are saved in `processed_urls.json` — delete this file to reprocess all URLs.

---

## Workflow

| Step | What happens |
|------|-------------|
| URL added to Table 1 col B | Agent detects it within 5 minutes |
| Community page scraped | Name, city, state, zip, type, schools extracted |
| Homes tab scraped | Floor plans: name, sqft, beds, baths, floors, price, ready-by |
| QMI tab scraped | Quick Move-In homes with lot numbers and addresses |
| Homesite map scraped | AlphaVision map → total / sold / for-sale / future lot counts |
| Table 2 written | Sold, For-Sale, Future Release, Total (same row as URL) |
| Table 3 written | One row per floor plan appended after row 15 |
| Ingest POST sent | Full payload with placeholders + real QMI listings |

---

## Lot counting logic

| Status | How detected |
|--------|-------------|
| **Sold** | Red circle on map OR lot status contains "sold"/"contract"/"closed" |
| **For Sale** | Lot has a price OR status is "available"/"active" |
| **Future Release** | Total − Sold − For Sale |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `FileNotFoundError: service_account.json` | Add the service account JSON file (see Setup step 2) |
| `gspread.exceptions.SpreadsheetNotFound` | Share the sheet with the service account email |
| Map counts all zero | AlphaVision iframe may require scroll/interaction — check `pulte_agent.log` for "Map API hit" |
| Ingest returns 4xx | Check the secret key in `INGEST_SECRET` config at top of script |
