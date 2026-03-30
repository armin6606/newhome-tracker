# Google Sheets Sync — Setup Instructions

This document explains how to connect the newhome-tracker database to the
Google Sheet so that `scripts/sync-sheet.mjs` and the GitHub Actions workflow
work correctly.

---

## Overview

The sync is bidirectional:

| Direction | What happens |
|-----------|-------------|
| **DB → Sheet** | All active listings are written to the sheet. Non-editable columns are always refreshed from the database. |
| **Sheet → DB** | User-entered values in the editable columns (HOA, Tax, Move-In Date, Schools, Notes) are read and saved back to the DB. |

The script runs automatically at **8:15 AM UTC every day** (15 minutes after
the daily scrape), and can also be triggered manually from the GitHub Actions
tab.

---

## Sheet Column Layout

| Col | Field | Editable? |
|-----|-------|-----------|
| A | Listing ID | No (key) |
| B | Address | No |
| C | Community | No |
| D | Builder | No |
| E | City | No |
| F | Price ($) | No |
| G | Beds | No |
| H | Baths | No |
| I | Sqft | No |
| J | Floors | No |
| K | $/sqft | No |
| **L** | **HOA ($/mo)** | **Yes** |
| **M** | **Annual Tax ($)** | **Yes** |
| **N** | **Move-In Date** | **Yes** |
| O | Floor Plan | No |
| P | Lot # | No |
| Q | Garages | No |
| **R** | **Schools** | **Yes** |
| S | Status | No |
| T | Source URL | No |
| **U** | **Notes** | **Yes** |

Columns marked **Yes** are never overwritten by the DB→Sheet push. Enter
anything you want in those cells and it will be preserved — and synced back
to the database the next morning.

---

## Step 1 — Create a Google Service Account

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project (or create a new one — a free project works fine).
3. In the left menu go to **APIs & Services → Enabled APIs & Services**.
4. Click **+ Enable APIs and Services**, search for **Google Sheets API**, and
   enable it.
5. In the left menu go to **APIs & Services → Credentials**.
6. Click **+ Create Credentials → Service account**.
7. Give it a name (e.g. `newhome-tracker-sheets`) and click **Create and
   Continue**. Skip the optional role steps, click **Done**.
8. Click the service account you just created, go to the **Keys** tab.
9. Click **Add Key → Create new key → JSON → Create**.
10. A `.json` file downloads automatically. **Keep this file safe — it is a
    secret credential.**

---

## Step 2 — Share the Google Sheet with the Service Account

1. Open the downloaded JSON key file. Copy the value of `"client_email"`.
   It looks like:
   ```
   newhome-tracker-sheets@your-project.iam.gserviceaccount.com
   ```
2. Open the Google Sheet:
   https://docs.google.com/spreadsheets/d/1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo/
3. Click **Share** (top right).
4. Paste the service account email address and give it **Editor** access.
5. Uncheck "Notify people" and click **Share**.

---

## Step 3 — Add GitHub Actions Secrets

Go to your GitHub repository → **Settings → Secrets and variables →
Actions → New repository secret** and add the following secrets:

| Secret name | Value |
|-------------|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The **entire contents** of the JSON key file you downloaded (paste the whole JSON object) |
| `SHEET_ID` | `1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo` |
| `SHEET_NAME` | `Listings` (or whatever tab name you want) |

The `DATABASE_URL` and `DIRECT_URL` secrets should already exist from the
scraper setup.

---

## Step 4 — Install the googleapis package

From the project root (`C:\newhome-tracker`), run:

```bash
npm install googleapis --save
```

Then commit the updated `package.json` and `package-lock.json`.

---

## Step 5 — Decide on the sheet tab

The script defaults to writing to a tab named **Listings** inside the
spreadsheet. The existing tab (with community-override data) is on gid=0.

**Option A (recommended):** Let the script create a brand-new "Listings" tab
automatically. The first time the script runs it will add the tab.

**Option B:** Rename the existing tab to "Community Overrides" and create a
blank tab named "Listings" yourself before running.

Either way, `lib/sheets.ts` (which reads the community-override data) uses
the CSV export URL with `gid=0` and is completely separate from the new sync
tab — they will not interfere with each other as long as the override data
stays on its original tab.

---

## Step 6 — First run

You can trigger the sync manually without waiting for the schedule:

1. Go to **GitHub → Actions → Sync Google Sheet**.
2. Click **Run workflow → Run workflow**.
3. Watch the logs. On a successful first run you will see lines like:
   ```
   Creating sheet tab "Listings"…
   Writing header row…
   Found 47 active listings in DB
   + Added [12] 101 Main St (Elm Collection Great Park)
   …
   Push complete: 47 added, 0 updated
   Pull complete: 0 DB records updated from sheet
   ```

---

## Running locally

To run the sync on your machine:

```bash
# From C:\newhome-tracker
export DATABASE_URL="postgresql://..."
export DIRECT_URL="postgresql://..."
export GOOGLE_SERVICE_ACCOUNT_JSON='{ "type": "service_account", ... }'
export SHEET_ID="1yBhf2bZqwzPich3EAS0bsc96m7cv6yGR8F2KQSRIGjo"
export SHEET_NAME="Listings"

node scripts/sync-sheet.mjs
```

On Windows PowerShell use `$env:DATABASE_URL = "..."` syntax instead of
`export`.

---

## How the Notes field maps to the database

The `Listing` model does not have a standalone `notes` column. User-entered
Notes from column U are stored in the `incentives` field in the database
(the closest available free-text field). You can rename this conceptually —
it will appear as "Notes" everywhere in the sheet.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set` | Secret not added to GitHub, or not exported locally |
| `The caller does not have permission` | Service account email not added as Editor on the sheet |
| `Requested entity was not found` | Wrong `SHEET_ID` value |
| Editable columns being overwritten | Check that `USER_EDITABLE_COLS` indices in `sync-sheet.mjs` match the correct 0-based column positions |
| Duplicate rows appearing | Ensure no two listings share the same ID in column A; re-running is safe since the script matches on Listing ID |
