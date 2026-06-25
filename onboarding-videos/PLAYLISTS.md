# VoltSafe CMS — Onboarding Playlists

Role-based training paths that tell each type of user exactly what to watch
and in what order. Each playlist is self-contained — users only watch what's
relevant to their role.

---

## Master playlist index

| Playlist | Audience | Videos included | Est. total time | Best use case |
|----------|----------|----------------|----------------|---------------|
| [Sales Team](playlists/01-sales-team-playlist.md) | AEs, SDRs, BDRs | 01, 02, 03, 06, 05, 04 | ~26 min | Full sales motion: leads → pipeline → AI outreach |
| [Executives](playlists/02-executive-playlist.md) | Founders, VP Sales, GMs | 01, 03, 06, 05, (04 optional) | ~17–21 min | Pipeline visibility and AI overview for leadership |
| [Marina Operators](playlists/03-marina-operator-playlist.md) | Harbour masters, dock staff | 01, (04 conditional) | ~8 min + future | Day-to-day marina operations; expands with new videos |
| [Support & Admin](playlists/04-support-admin-playlist.md) | CS, support reps, admins | 01, 02, 04, 06 | ~17 min | CRM data management + customer inquiry handling |
| [New Employees](playlists/05-new-employee-playlist.md) | All new hires | 01, 02, 03, 06, 05, 04 | ~26 min | Complete week-one onboarding path for any CRM role |

---

## Which playlist should I use?

```
Are you new to VoltSafe CMS?
  └─ YES → Start with: New Employees (05)
           Then return here and pick your role playlist below.
  └─ NO  → Pick your role:

           Sales rep / AE / SDR  → Sales Team (01)
           Executive / VP / GM   → Executives (02)
           Marina operator        → Marina Operators (03)
           Support / Admin / CS   → Support & Admin (04)
```

---

## Video library (all current recordings)

| ID | Video title | Duration | Storyboard |
|----|------------|----------|-----------|
| 01 | Dashboard Overview | ~3.5 min | [storyboard](storyboards/01-dashboard-overview.md) |
| 02 | Leads, Accounts & Contacts | ~4.5 min | [storyboard](storyboards/02-leads-accounts-contacts.md) |
| 03 | Marina Lead Pipeline | ~4.5 min | [storyboard](storyboards/03-marina-lead-pipeline.md) |
| 04 | VoltSafe Mail Overview | ~4.5 min | [storyboard](storyboards/04-voltsafe-mail-overview.md) |
| 05 | AI Email Generator | ~4.5 min | [storyboard](storyboards/05-ai-email-generator.md) |
| 06 | Account Intelligence View | ~4.5 min | [storyboard](storyboards/06-account-intelligence-view.md) |

---

## Playlist coverage map

Which videos appear in which playlists:

| Video | Sales | Exec | Marina Op | Support/Admin | New Employee |
|-------|:-----:|:----:|:---------:|:-------------:|:------------:|
| 01 Dashboard Overview | ✓ | ✓ | ✓ | ✓ | ✓ |
| 02 Leads, Accounts & Contacts | ✓ | — | — | ✓ | ✓ |
| 03 Marina Lead Pipeline | ✓ | ✓ | — | — | ✓ |
| 04 VoltSafe Mail Overview | ✓ | optional | conditional | ✓ | ✓ |
| 05 AI Email Generator | ✓ | ✓ | — | — | ✓ |
| 06 Account Intelligence View | ✓ | ✓ | — | ✓ | ✓ |

---

## Future videos — planned playlist additions

These recordings don't exist yet. Each is marked with the playlists they'll join
when recorded:

| Future video | Sales | Exec | Marina Op | Support/Admin | New Employee |
|-------------|:-----:|:----:|:---------:|:-------------:|:------------:|
| Marina Dashboard | — | — | ✓ | — | — |
| Slip Management | — | — | ✓ | — | — |
| Power Session Management | — | — | ✓ | — | — |
| Boater App | — | — | ✓ | — | — |
| User Permissions | — | — | — | ✓ | ✓ |
| Reporting & Analytics | ✓ | ✓ | — | ✓ | ✓ |
| Issue / Support Workflow | — | — | — | ✓ | ✓ |
| True Duplicate Merge Engine | — | — | — | ✓ | — |
| Revenue Simulator | — | ✓ | — | — | — |

---

## How to add a new playlist

1. Create a new file in `onboarding-videos/playlists/` following the naming
   pattern `NN-role-name-playlist.md`
2. Use an existing playlist as a template
3. Add a row to the master index table above
4. Add a row to the coverage map
5. Link from `onboarding-videos/README.md` if it's a primary audience

---

## How to add a new video to an existing playlist

1. Record the video using `npm run video:NAME` (or add a new script)
2. Create a storyboard in `onboarding-videos/storyboards/`
3. Add the video to the relevant playlist files under the appropriate section
4. Update the master index table and coverage map above
5. Move it from the "Future videos" table to the main video library table
