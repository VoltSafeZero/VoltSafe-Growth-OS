# US Marina Research — ChatGPT Instructions

**Copy everything below this line into a ChatGPT conversation along with the
`usa_marinas_for_chatgpt.csv` file.** ChatGPT will read the CSV, do web
research, and return an updated CSV that you can review and import into the
VoltSafe CMS.

---

## Mission

You are helping VoltSafe build the most complete database of marinas in the
United States. I'm attaching a CSV (`usa_marinas_for_chatgpt.csv`) that
contains every US marina currently in our CRM (9,913 rows) plus three
example template rows showing the exact format you must follow. Your two
jobs are:

1. **Find new US marinas** that are NOT already in the CSV and add a row
   for each one. Aim for nationwide coverage — every state and territory,
   including small/private/seasonal facilities and inland-lake marinas, not
   just famous waterfront destinations.
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

The rest of the rows (rows 5 onward) are the 9,913 existing US marinas,
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

1. Exact name match (case-insensitive, ignoring `Inc.` / `LLC` / `Marina` /
   `The`)
2. Same city + similar name (e.g. "Riverside Marina" and "Riverside Boat
   Yard" in the same city — likely the same place)
3. Same ZIP + any name overlap
4. Same street address

If you find a likely match, treat it as `EXISTING_ENRICH` (or `_KEEP`),
**not** as `NEW`. When in doubt, prefer `EXISTING_ENRICH` and explain in
the `notes` column why you think it's the same marina.

Many large operators (Suntex Marinas, Safe Harbor, Westrec, Marinas
International, Oasis Marinas, F3 Marina, etc.) own dozens of locations
under their own brand names — search for both the parent brand AND the
local name to avoid duplicates.

---

## Field-by-field guidance

### Identity (always required)

| Column        | Notes                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `name`        | Public-facing marina name. Don't add `Inc.` / `LLC` unless that's how the marina presents itself.    |
| `legal_name`  | Only fill if you find a state corporate registration.                                                |
| `website`     | Full URL with `https://`. Skip Facebook-only or no-website marinas.                                  |

### Location (fill as much as possible)

| Column          | Allowed values / format                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `street_address`| Full street address; no city/state/ZIP in this cell.                                               |
| `city`          | Plain city name.                                                                                   |
| `state_province`| **Full English name**, e.g. `Florida`, `New York`, `California`, `Michigan`, `Texas`. Do NOT use abbreviations like `FL` or `NY`. For territories use `Puerto Rico`, `U.S. Virgin Islands`, `Guam`, `American Samoa`, `Northern Mariana Islands`. For the capital use `District of Columbia`. |
| `postal_zip`    | US ZIP: 5 digits or 5+4 (`12345` or `12345-6789`).                                                 |
| `country`       | Always `US`.                                                                                       |
| `region`        | Pick one of the 11 regions below.                                                                  |
| `timezone`      | IANA name (see timezone table below).                                                              |
| `latitude`      | Decimal degrees, 4–6 digit precision. Positive for the contiguous US, AK, HI.                       |
| `longitude`     | Decimal degrees, 4–6 digit precision. **Negative** for the entire US (e.g. `-80.1373`).            |

#### Region buckets (use exactly one of these strings)

| Region              | States / territories included                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `Northeast`         | ME, NH, VT, MA, RI, CT, NY, NJ, PA                                           |
| `Mid-Atlantic`      | DE, MD, DC, WV, VA                                                           |
| `Southeast`         | NC, SC, GA, FL, AL                                                           |
| `Gulf`              | MS, LA, TX                                                                   |
| `Great Lakes`       | OH, IN, IL, WI, MI, MN                                                       |
| `Inland South`      | KY, TN, AR, OK, MO                                                           |
| `Plains`            | ND, SD, NE, KS, IA                                                           |
| `Mountain`          | MT, ID, WY, CO, UT, NV, AZ, NM                                               |
| `Pacific Northwest` | WA, OR                                                                       |
| `Pacific Southwest` | CA, HI                                                                       |
| `Alaska`            | AK                                                                           |
| `Territories`       | PR, USVI, GU, AS, MP                                                         |

#### Timezone reference (IANA)

| Timezone               | Where                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `America/New_York`     | Eastern: ME, NH, VT, MA, RI, CT, NY, NJ, PA, OH, eastern IN/MI/KY/TN, GA, FL (most), SC, NC, VA, WV, MD, DE, DC |
| `America/Chicago`      | Central: AL, AR, IL, IA, eastern KS/NE/SD/ND, western KY, LA, MN, MS, MO, OK, western TN, most TX, WI, western IN, FL panhandle |
| `America/Denver`       | Mountain (DST): CO, MT, NM, UT, WY, western ND/SD/NE/KS, eastern ID         |
| `America/Phoenix`      | Arizona (no DST). The Navajo Nation observes DST, but for marinas use `America/Denver` if uncertain. |
| `America/Los_Angeles`  | Pacific: CA, NV, OR, WA, northern ID                                        |
| `America/Anchorage`    | Most of Alaska                                                              |
| `America/Adak`         | Aleutian Islands (Adak, Atka)                                               |
| `Pacific/Honolulu`     | Hawaii (no DST)                                                             |
| `America/Puerto_Rico`  | Puerto Rico                                                                 |
| `America/St_Thomas`    | U.S. Virgin Islands                                                         |
| `Pacific/Guam`         | Guam, Northern Mariana Islands                                              |
| `Pacific/Pago_Pago`    | American Samoa                                                              |

### Marina specifics

| Column                  | Allowed values / format                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `segment`               | `marina` (default), `yacht_club`, `dry_stack`, `boat_club`, `mooring_field`, `government_dock`.  |
| `marina_type`           | `private`, `public`, `municipal`, `private_club`, `resort`, `non_profit`, `co_op`, `state_park`, `federal`. |
| `ownership_type`        | `owner_operated`, `family`, `corporate`, `non_profit`, `municipal`, `state`, `federal`, `tribal`.|
| `parent_company`        | If part of a chain (Suntex, Safe Harbor, Westrec, Marinas International, Oasis Marinas, F3 Marina, RCR Yachts, etc.). Otherwise leave blank. |
| `slip_count`            | Integer total wet slips. Skip if not publicly stated.                                            |
| `slip_mix`              | Free text, e.g. `70% seasonal, 30% transient` or `mostly transient, no seasonal`.                |
| `avg_boat_size_range`   | Free text, e.g. `20-45 ft`, `up to 80 ft`, `superyacht 80-200 ft`.                               |
| `power_demand_intensity`| `low` / `medium` / `high`. Heuristic: `low` = mostly 15-30A; `medium` = 30-50A common; `high` = 50A+ on most slips, big yachts, 100A pedestals. South Florida and other big-yacht hubs trend `high`. |
| `seasonality`           | Free text, e.g. `April-October`, `year-round`, `Memorial Day - Columbus Day`.                    |
| `expansion_plans`       | `true` only if you find PUBLIC evidence (news, planning permits, ACOE permits). Otherwise `false` or blank. |
| `expansion_notes`       | Cite the source if `expansion_plans = true`.                                                     |

### Primary contact (best-available person)

| Column             | Notes                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| `contact_name`     | Owner, GM, dockmaster, harbormaster — best-available. First + last name.       |
| `contact_title`    | Their actual public title.                                                     |
| `contact_email`    | Direct email if listed; otherwise `info@…` is acceptable.                      |
| `contact_phone`    | E.164 with leading `+` and country code: `+1-757-555-0123`.                    |
| `contact_linkedin` | Full LinkedIn profile URL if you find them.                                    |

### CRM metadata

| Column        | Notes                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `tags`        | Lowercase, hyphenated, comma-separated inside one cell: `gulf,florida,private,big-yacht`.          |
| `notes`       | Free-form research notes. **ALWAYS include the date and source URL** for any data you added. Example: `Slip count and dockmaster from marina website 2026-04-28 (https://example.com/about).` |
| `lead_source` | For `NEW` rows: `chatgpt_research_2026_usa`. For enrichment rows: leave blank.                     |

---

## What you must NOT do

- ❌ Do not invent data. If you can't verify it, leave the cell blank.
- ❌ Do not change the `name` of an existing marina — names are matched on
  re-import.
- ❌ Do not change the `cms_account_id` of an existing row.
- ❌ Do not overwrite a non-empty cell on an existing row, even if you
  think you have better data. Add your alternative to the `notes` column
  with a date and let me decide.
- ❌ Do not add Canadian marinas, Caribbean marinas (other than US
  territories), or marinas anywhere outside the US and its territories.
  This file is US-only.
- ❌ Do not add charter companies, sailing schools, boat dealers, brokers,
  shipyards, or boat clubs without slips, unless they also operate a
  marina with overnight wet slips.
- ❌ Do not add Facebook URLs, Instagram URLs, Yelp URLs, or Google Maps
  URLs in the `website` column — only the marina's own domain.
- ❌ Do not use 2-letter state abbreviations in the `state_province`
  column. Always full English names.

---

## Source-quality rules

Use only **publicly accessible** sources. Good sources include:

- The marina's own website
- Marina-association rosters: AMI (Association of Marina Industries),
  state-level marine trades associations (Florida Marine Industries,
  Marine Trades Association of New Jersey, Massachusetts Marine Trades,
  Recreational Boaters of California, etc.)
- Discover Boating, NMMA member directories
- US Army Corps of Engineers marina lists (for inland-lake marinas at
  USACE-managed reservoirs: Cumberland, Lanier, Hartwell, Kentucky Lake,
  Lake of the Ozarks, etc.)
- Bureau of Reclamation concessionaire lists (Lake Powell, Lake Mead, etc.)
- State park concessionaire lists (state-park marinas in OK, TN, KY, AL,
  GA, etc.)
- National Park Service concessionaire lists (Glen Canyon, Lake Mead,
  Big Bend, etc.)
- Public state corporate registries (Sunbiz for Florida, NY DOS, CA SOS,
  etc.)
- Wikipedia and OpenStreetMap (cross-check before trusting)
- News articles and government planning documents (for expansion plans,
  permitting, recent ownership changes)

Bad sources to avoid:

- Aggregators that bulk-scrape (often stale or wrong)
- Yelp / TripAdvisor reviews (the "address" is often the reviewer's)
- Boat-listing sites that mention a marina in passing
- Anything behind a paywall or login

When in doubt, leave the cell blank and note your uncertainty in `notes`.

---

## How to deliver the result

Return a single CSV file (call it `usa_marinas_enriched.csv`) with:

1. The same 33-column header row, in the same order.
2. (No example rows.)
3. All 9,913 existing rows — each with `action` set to either
   `EXISTING_ENRICH` or `EXISTING_KEEP`.
4. New rows at the bottom with `action = NEW`, one per discovered marina.

In your message, include a brief summary:
- How many existing rows you enriched
- How many new marinas you added, broken down by state
- Top 3 sources you relied on
- Any states where you struggled to find good data

---

## Quality bar I'm looking for

Aim for **at least 1,500–3,000 new US marinas** beyond the 9,913 already
in the file. Current under-represented areas where you should focus first:

- **Texas (only 290)** — should be 600+. Massive Gulf coast (Galveston,
  Corpus Christi, South Padre, Port Aransas, Kemah), inland reservoirs
  (Lake Travis, Lake Conroe, Lake Texoma, Lake Buchanan, Sam Rayburn,
  Toledo Bend, Cedar Creek, Possum Kingdom, Whitney, Belton, etc.).
- **California (only 660)** — should be 1,000+. SF Bay, Sacramento Delta,
  San Diego, LA basin (Marina del Rey, King Harbor, Long Beach), Channel
  Islands, plus Lake Tahoe, Shasta, Folsom, Berryessa, Havasu, Don Pedro,
  Oroville, Trinity, etc.
- **Mountain West reservoirs**: AZ (only 23), CO (25), NV (10), UT (13),
  NM (5), WY (11) — Lake Powell, Lake Mead, Lake Mohave, Lake Havasu,
  Bartlett Lake, Pleasant, Sand Hollow, Powell, Flaming Gorge, Granby,
  Dillon, Pueblo, Conchas, Elephant Butte, Boysen, Bighorn, etc.
- **Inland South lakes**: AR (64), OK (67), KY (110), MO (107) —
  Bull Shoals, Greers Ferry, Beaver, Norfork, Dardanelle, Eufaula,
  Tenkiller, Texoma, Grand Lake o'the Cherokees, Cumberland, Kentucky
  Lake, Barkley, Dale Hollow, Truman, Table Rock, Stockton, etc.
- **Pacific Northwest**: OR (only 123) — Columbia River, Oregon coast,
  inland lakes (Roosevelt, Owyhee, Detroit, etc.).
- **Hawaii (only 39)** — all 4 main islands need more coverage.
- **Alaska (60)** — Southeast (Ketchikan, Juneau, Sitka, Petersburg,
  Wrangell), Kenai Peninsula, Kodiak, Anchorage area.
- **Great Lakes inland**: MN (103) is light for the "Land of 10,000 Lakes",
  IN (68) light for inland reservoirs.
- **Pennsylvania (122)** is light — Lake Erie + many inland reservoirs and
  the Susquehanna.
- **Mississippi (56)** is very light for a Gulf state.

For enrichment, the highest-value fields are:

1. `website` (currently blank for most rows)
2. `slip_count`
3. `contact_email` and `contact_name` (any human contact at all)
4. `latitude` / `longitude` (geo plotting)
5. `marina_type` and `ownership_type`
6. `parent_company` (consolidation is rapid in US marina ownership; lots
   of independent marinas have been bought by Suntex, Safe Harbor, Oasis,
   Westrec, F3, etc. in the last 5 years)

Thank you. Be thorough, be honest about what you couldn't find, and cite
your sources in the `notes` column for every cell you fill.
