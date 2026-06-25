/**
 * Training Hub static data.
 * Playlists, videos, and future placeholders are defined here.
 * Swap `videoUrl` for a Vimeo / YouTube / HubSpot URL when ready —
 * the rest of the UI picks it up automatically.
 */

export interface TrainingPlaylist {
  id: string;
  title: string;
  audience: string;
  description: string;
  estimatedTime: string;
  videoIds: string[];       // references Video.id
  filePath: string;         // onboarding-videos/playlists/XX-name.md
  icon: string;             // emoji used in cards
}

export interface TrainingVideo {
  id: string;
  number: string;           // "01", "02", …
  title: string;
  description: string;
  duration: string;
  audiences: string[];
  /**
   * Local raw path for when no hosted URL exists yet.
   * Swap for a Vimeo/YouTube/HubSpot URL at any time.
   */
  videoUrl: string | null;
  storyboardPath: string;   // onboarding-videos/storyboards/XX-name.md
}

export interface FutureVideo {
  id: string;
  title: string;
  description: string;
  targetAudiences: string[];
  playlistIds: string[];    // which playlists this will join
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based playlists
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_PLAYLISTS: TrainingPlaylist[] = [
  {
    id: "sales",
    title: "Sales Team",
    audience: "AEs, SDRs, BDRs",
    description: "The complete sales motion — from prospecting leads to AI-powered outreach.",
    estimatedTime: "~26 min",
    videoIds: ["01", "02", "03", "06", "05", "04"],
    filePath: "onboarding-videos/playlists/01-sales-team-playlist.md",
    icon: "🎯",
  },
  {
    id: "executive",
    title: "Executives",
    audience: "Founders, VP Sales, GMs",
    description: "Pipeline visibility, account intelligence, and AI overview for leadership.",
    estimatedTime: "~17–21 min",
    videoIds: ["01", "03", "06", "05"],
    filePath: "onboarding-videos/playlists/02-executive-playlist.md",
    icon: "📊",
  },
  {
    id: "marina-operator",
    title: "Marina Operators",
    audience: "Harbour masters, dock staff",
    description: "Day-to-day marina operations. Expands as marina-specific videos are released.",
    estimatedTime: "~8 min + future videos",
    videoIds: ["01"],
    filePath: "onboarding-videos/playlists/03-marina-operator-playlist.md",
    icon: "⚓",
  },
  {
    id: "support-admin",
    title: "Support & Admin",
    audience: "CS managers, support reps, CRM admins",
    description: "CRM data management, inbox handling, and customer inquiry workflows.",
    estimatedTime: "~17 min",
    videoIds: ["01", "02", "04", "06"],
    filePath: "onboarding-videos/playlists/04-support-admin-playlist.md",
    icon: "🛠",
  },
  {
    id: "new-employee",
    title: "New Employees",
    audience: "All new hires with CRM access",
    description: "Complete week-one onboarding path covering every area of VoltSafe CMS.",
    estimatedTime: "~26 min",
    videoIds: ["01", "02", "03", "06", "05", "04"],
    filePath: "onboarding-videos/playlists/05-new-employee-playlist.md",
    icon: "👋",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Current video library
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_VIDEOS: TrainingVideo[] = [
  {
    id: "01",
    number: "01",
    title: "Dashboard Overview",
    description:
      "A 3-minute tour of VoltSafe CMS — the Command Center, Executive Dashboard, Pipeline, Mail, and AI Copilot. Watch this first.",
    duration: "~3.5 min",
    audiences: ["All roles"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/01-dashboard-overview.md",
  },
  {
    id: "02",
    number: "02",
    title: "Leads, Accounts & Contacts",
    description:
      "How the CRM is structured — leads as prospects, accounts as active relationships, and contacts as the people behind each marina.",
    duration: "~4.5 min",
    audiences: ["Sales", "Support/Admin", "New Employee"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/02-leads-accounts-contacts.md",
  },
  {
    id: "03",
    number: "03",
    title: "Marina Lead Pipeline",
    description:
      "How a marina moves from New Lead to Closed Won — kanban stages, deal cards, list view, and the forecast dashboard.",
    duration: "~4.5 min",
    audiences: ["Sales", "Exec", "New Employee"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/03-marina-lead-pipeline.md",
  },
  {
    id: "04",
    number: "04",
    title: "VoltSafe Mail Overview",
    description:
      "The CRM-connected inbox — Priority and People tabs, opening threads with full CRM context, and composing outbound email.",
    duration: "~4.5 min",
    audiences: ["Sales", "Support/Admin", "New Employee"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/04-voltsafe-mail-overview.md",
  },
  {
    id: "05",
    number: "05",
    title: "AI Email Generator",
    description:
      "How Cortex AI generates personalised outreach from account context — reading the intelligence panel, triggering the generator, and reviewing the draft.",
    duration: "~4.5 min",
    audiences: ["Sales", "Exec", "New Employee"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/05-ai-email-generator.md",
  },
  {
    id: "06",
    number: "06",
    title: "Account Intelligence View",
    description:
      "The pre-call research workflow — activity timeline, champion contact, open deals, email history, and notes before any call or email.",
    duration: "~4.5 min",
    audiences: ["Sales", "Exec", "Support/Admin", "New Employee"],
    videoUrl: null,
    storyboardPath: "onboarding-videos/storyboards/06-account-intelligence-view.md",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Planned future videos
// ─────────────────────────────────────────────────────────────────────────────

export const FUTURE_VIDEOS: FutureVideo[] = [
  {
    id: "marina-dashboard",
    title: "Marina Dashboard",
    description: "Live slip occupancy, power sessions, and real-time boater activity.",
    targetAudiences: ["Marina Operators"],
    playlistIds: ["marina-operator"],
  },
  {
    id: "slip-management",
    title: "Slip Management",
    description: "Assign boats to slips, track availability, and manage occupancy.",
    targetAudiences: ["Marina Operators"],
    playlistIds: ["marina-operator"],
  },
  {
    id: "power-session-management",
    title: "Power Session Management",
    description: "Monitor shore power usage, session billing, and operator controls.",
    targetAudiences: ["Marina Operators"],
    playlistIds: ["marina-operator"],
  },
  {
    id: "boater-app",
    title: "Boater App",
    description: "What boaters see and how marina operators interact with the boater-facing interface.",
    targetAudiences: ["Marina Operators"],
    playlistIds: ["marina-operator"],
  },
  {
    id: "user-permissions",
    title: "User Permissions",
    description: "Managing user roles, section access levels, and mailbox connections.",
    targetAudiences: ["Support/Admin", "New Employee"],
    playlistIds: ["support-admin", "new-employee"],
  },
  {
    id: "reporting-analytics",
    title: "Reporting & Analytics",
    description: "Pipeline metrics, activity reports, win/loss tracking, and team performance KPIs.",
    targetAudiences: ["Sales", "Exec", "Support/Admin", "New Employee"],
    playlistIds: ["sales", "executive", "support-admin", "new-employee"],
  },
  {
    id: "issue-support-workflow",
    title: "Issue / Support Workflow",
    description: "How to log, track, and resolve customer issues and support cases in the CRM.",
    targetAudiences: ["Support/Admin", "New Employee"],
    playlistIds: ["support-admin", "new-employee"],
  },
];
