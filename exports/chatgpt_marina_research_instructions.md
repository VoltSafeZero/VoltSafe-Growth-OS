# Canadian Marina Research — ChatGPT Instructions

**Copy everything below this line into a ChatGPT conversation along with the
`canadian_marinas_for_chatgpt.csv` file.** ChatGPT will read the CSV, do web
research, and return an updated CSV that you can review and import into the
VoltSafe CMS.

---

## Mission

You are helping VoltSafe build the most complete database of marinas in
Canada. I'm attaching a CSV (`canadian_marinas_for_chatgpt.csv`) that
contains every Canadian marina currently in our CRM (967 rows) plus three
example template rows showing the exact format you must follow. Your two
jobs are:

1. **Find new Canadian marinas** that are NOT already in the CSV and add a
   row for each one. Aim for comprehensive nationwide coverage — every
   province and territory, including small/private/seasonal facilities, not
   just big-name marinas.
2. **Enrich existing rows** by filling in **empty fields only** where you
   can find reliable public data. Never overwrite a non-empty cell.

Return the result as a single CSV file with the **same 33 columns in the
same order**, ready to import.

---

## How the CSV is structured

The first row is the header. The next three rows are **examples** showing
the three action types:
- `EXAMPLE_NEW` — what a brand-new marina row looks like
- `EXAMPLE_ENRICH` — what an enrichment row looks like (existing marina,
  most cells blank, only the newly-found cells filled, plus a note saying
  what was added)
- `EXAMPLE_KEEP` — what a "no new info found" row looks like (existing
  marina, every cell blank except the action, ID, and name)

**Delete those three example rows in your output.** They're for reference
only.

The rest of the rows (rows 5 onward) are the 967 existing Canadian marinas,
each marked `EXISTING` in the `action` column. Your job is to:

- Change `EXISTING` → `EXISTING_ENRICH` if you found new data and filled
  in any previously-empty cells
- Change `EXISTING` → `EXISTING_KEEP` if you found no new data
- Add brand-new rows at the bottom with `action = NEW` for marinas not
  already in the file

---

## The action column — exact rules

| action            | When to use                                                                  | Required fields                              | Behavior on import                                       |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `NEW`             | Marina is not in the CSV. You discovered it through research.                | `name`, `city`, `state_province`, `country`  | Insert as new account.                                   |
| `EXISTING_ENRICH` | Marina is in the CSV (you can see its `cms_account_id`) AND you filled cells | `cms_account_id`, `name`, ≥1 enriched cell    | Update only the cells you filled. Existing values kept.  |
| `EXISTING_KEEP`   | Marina is in the CSV but you found nothing new to add                        | `cms_account_id`, `name`                     | No-op. Helps me confirm you reviewed every row.          |

---

## Dedup — how to know if a marina is already in the CSV

Before adding a `NEW` row, search the CSV for a possible match using **any
of**:

1. Exact name match (case-insensitive, ignoring `Inc.` / `Ltd` / `Marina` /
   `The`)
2. Same city + similar name (e.g. "Riverside Marina" and "Riverside Boat
   Yard" in the same city — likely the same place)
3. Same postal code + any name overlap
4. Same street address

If you find a likely match, treat it as `EXISTING_ENRICH` (or `_KEEP`),
**not** as `NEW`. When in doubt, prefer `EXISTING_ENRICH` and explain in
the `notes` column why you think it's the same marina.

---

## Field-by-field guidance

### Identity (always required)

| Column        | Notes                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `name`        | Public-facing marina name. Don't add `Inc.` / `Ltd` unless that's how the marina presents itself.    |
| `legal_name`  | Only fill if you find a corporate registration (Industry Canada, provincial registry).               |
| `website`     | Full URL with `https://`. Skip Facebook-only or no-website marinas.                                  |

### Location (fill as much as possible)

| Column          | Allowed values / format                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `street_address`| Full street address; no city/province/postal in this cell.                                         |
| `city`          | Plain city name.                                                                                   |
| `state_province`| **Full English name**: `Ontario`, `Quebec`, `British Columbia`, `Alberta`, `Manitoba`, `Saskatchewan`, `Nova Scotia`, `New Brunswick`, `Newfoundland and Labrador`, `Prince Edward Island`, `Yukon`, `Northwest Territories`, `Nunavut`. Do NOT use abbreviations. |
| `postal_zip`    | Canadian format `A1A 1A1` (with the space).                                                        |
| `country`       | Always `CA`.                                                                                       |
| `region`        | Pick one: `Atlantic`, `Central`, `Prairie`, `Pacific`, `Northern`. (Atlantic = NL/NS/NB/PE; Central = ON/QC; Prairie = MB/SK/AB; Pacific = BC; Northern = YT/NT/NU.) |
| `timezone`      | IANA name: `America/St_Johns`, `America/Halifax`, `America/Toronto`, `America/Winnipeg`, `America/Edmonton`, `America/Vancouver`, `America/Whitehorse`, etc. |
| `latitude`      | Decimal degrees, 4–6 digit precision. Positive for Canada.                                         |
| `longitude`     | Decimal degrees, 4–6 digit precision. **Negative** for Canada (e.g. `-79.3832`).                   |

### Marina specifics

| Column                  | Allowed values / format                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `segment`               | `marina` (default), `yacht_club`, `dry_stack`, `boat_club`, `mooring_field`, `government_dock`.  |
| `marina_type`           | `private`, `public`, `municipal`, `private_club`, `resort`, `non_profit`, `co_op`.               |
| `ownership_type`        | `owner_operated`, `family`, `corporate`, `non_profit`, `municipal`, `first_nation`, `crown`.     |
| `parent_company`        | If part of a chain (Skyline, Suntex, Westport, etc.). Otherwise leave blank.                     |
| `slip_count`            | Integer total wet slips. Skip if not publicly stated.                                            |
| `slip_mix`              | Free text, e.g. `70% seasonal, 30% transient` or `mostly seasonal`.                              |
| `avg_boat_size_range`   | Free text, e.g. `20-45 ft`, `up to 60 ft`.                                                       |
| `power_demand_intensity`| `low` / `medium` / `high`. Heuristic: `low` = mostly 15-30A; `medium` = 30-50A common; `high` = 50A+ on most slips, big yachts. |
| `seasonality`           | Free text, e.g. `May-October`, `year-round`, `April 15 - November 1`.                            |
| `expansion_plans`       | `true` only if you find PUBLIC evidence (news, planning permits). Otherwise `false` or blank.    |
| `expansion_notes`       | Cite the source if `expansion_plans = true`.                                                     |

### Primary contact (best-available person)

| Column             | Notes                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| `contact_name`     | Owner, GM, dockmaster, harbourmaster — best-available. First + last name.      |
| `contact_title`    | Their actual public title.                                                     |
| `contact_email`    | Direct email if listed; otherwise `info@…` is acceptable.                      |
| `contact_phone`    | E.164 with leading `+` and country code: `+1-902-555-0123`.                    |
| `contact_linkedin` | Full LinkedIn profile URL if you find them.                                    |

### CRM metadata

| Column        | Notes                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `tags`        | Lowercase, hyphenated, comma-separated inside one cell: `great-lakes,ontario,private,family-owned`.|
| `notes`       | Free-form research notes. **ALWAYS include the date and source URL** for any data you added. Example: `Slip count and dockmaster from marina website 2026-04-28 (https://example.ca/about).` |
| `lead_source` | For `NEW` rows: `chatgpt_research_2026_canada`. For enrichment rows: leave blank.                  |

---

## What you must NOT do

- ❌ Do not invent data. If you can't verify it, leave the cell blank.
- ❌ Do not change the `name` of an existing marina — names are matched on
  re-import.
- ❌ Do not change the `cms_account_id` of an existing row.
- ❌ Do not overwrite a non-empty cell on an existing row, even if you
  think you have better data. Add your alternative to the `notes` column
  with a date and let me decide.
- ❌ Do not add U.S. marinas, Caribbean marinas, or marinas anywhere
  outside Canada. This file is Canada-only.
- ❌ Do not add charter companies, sailing schools, boat dealers, or
  shipyards unless they also operate a marina with overnight slips.
- ❌ Do not add Facebook URLs, Instagram URLs, or Google Maps URLs in the
  `website` column — only the marina's own domain.

---

## Source-quality rules

Use only **publicly accessible** sources. Good sources include:

- The marina's own website
- Provincial / federal marina directories (e.g. Discover Boating Canada,
  TC Discover, NMMA Canada, Boating Industry Canada)
- Public Industry Canada / provincial corporate registries
- Boating Ontario / BC Marine Trades / APBA / BHP membership rosters
- Wikipedia and OpenStreetMap (cross-check before trusting)
- News articles and government planning documents (for expansion plans)

Bad sources to avoid:

- Aggregators that bulk-scrape (often stale or wrong)
- Yelp / TripAdvisor reviews (the "address" is often the review-poster's)
- Boat-listing sites that mention a marina in passing
- Anything behind a paywall or login

When in doubt, leave the cell blank and note your uncertainty in `notes`.

---

## How to deliver the result

Return a single CSV file (call it `canadian_marinas_enriched.csv`) with:

1. The same 33-column header row, in the same order.
2. (No example rows.)
3. All 967 existing rows — each with `action` set to either
   `EXISTING_ENRICH` or `EXISTING_KEEP`.
4. New rows at the bottom with `action = NEW`, one per discovered marina.

In your message, include a brief summary:
- How many existing rows you enriched
- How many new marinas you added, broken down by province
- Top 3 sources you relied on
- Any provinces where you struggled to find good data

---

## Quality bar I'm looking for

Aim for **at least 200–400 new Canadian marinas** beyond the 967 already in
the file. Prioritize coverage of:

- Atlantic Canada (NS, NB, PE, NL) — currently underrepresented
- Quebec — only 88 in our file vs. several hundred actually exist
- BC inland lakes (Okanagan, Kootenays, Shuswap)
- Manitoba and Saskatchewan (Lake Winnipeg, Lake of the Prairies, etc.)
- Northern Ontario (Lake Superior, James Bay, Lake Nipigon)

For enrichment, the highest-value fields are:

1. `website` (currently blank for most rows)
2. `slip_count`
3. `contact_email` and `contact_name` (any human contact at all)
4. `latitude` / `longitude` (geo plotting)
5. `marina_type` and `ownership_type`

Thank you. Be thorough, be honest about what you couldn't find, and cite
your sources in the `notes` column for every cell you fill.
