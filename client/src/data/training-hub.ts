/**
 * Training Hub static data.
 *
 * To publish a hosted video:
 *   1. Set videoUrl to the Vimeo / YouTube / HubSpot / Loom URL
 *   2. Set hostedProvider to the matching value
 *   3. Set status to "hosted"
 *   4. Save — the Watch Video button enables automatically.
 *
 * See onboarding-videos/HOSTING.md for the full step-by-step guide.
 */

export type VideoStatus =
  | "not_recorded"   // script exists, recording not yet started
  | "raw_recorded"   // .webm raw capture done, needs narration/editing
  | "edited"         // final .mp4 produced, not yet uploaded
  | "hosted"         // live hosted URL available
  | "needs_update";  // UI has changed since last recording

export type HostedProvider = "vimeo" | "youtube" | "hubspot" | "loom" | "local" | "other";

export interface TrainingPlaylist {
  id: string;
  title: string;
  audience: string;
  description: string;
  estimatedTime: string;
  videoIds: string[];
  filePath: string;
  icon: string;
  /** If set, only these emails can see this playlist (case-insensitive). Omit for everyone. */
  restrictedToEmails?: string[];
}

export interface TrainingVideo {
  id: string;
  number: string;
  title: string;
  description: string;
  duration: string;
  audiences: string[];
  status: VideoStatus;
  /** Hosted URL — Vimeo, YouTube unlisted, HubSpot, Loom, etc. */
  videoUrl?: string;
  hostedProvider?: HostedProvider;
  /** onboarding-videos/outputs/raw/[name].webm */
  rawVideoPath?: string;
  /** onboarding-videos/outputs/final/[name].mp4 */
  finalVideoPath?: string;
  /** onboarding-videos/storyboards/[name].md */
  storyboardPath: string;
  /** If set, only these emails can see this video (case-insensitive). Omit for everyone. */
  restrictedToEmails?: string[];
}

export interface FutureVideo {
  id: string;
  title: string;
  description: string;
  targetAudiences: string[];
  playlistIds: string[];
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
  {
    id: "capital-cfo-onboarding",
    title: "Capital Module — CFO Onboarding",
    audience: "CFO & CEO only",
    description: "A focused walkthrough of the Capital module — investor pipeline, data room, follow-ups, engagement, and reporting — using sample data.",
    estimatedTime: "~15 min",
    videoIds: ["cap-01", "cap-02", "cap-03", "cap-04", "cap-05"],
    filePath: "onboarding-videos/playlists/06-capital-cfo-onboarding-playlist.md",
    icon: "💰",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/01-dashboard-overview.webm",
    finalVideoPath: "onboarding-videos/outputs/final/01-dashboard-overview.mp4",
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/02-leads-accounts-contacts.webm",
    finalVideoPath: "onboarding-videos/outputs/final/02-leads-accounts-contacts.mp4",
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/03-marina-lead-pipeline.webm",
    finalVideoPath: "onboarding-videos/outputs/final/03-marina-lead-pipeline.mp4",
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/04-voltsafe-mail-overview.webm",
    finalVideoPath: "onboarding-videos/outputs/final/04-voltsafe-mail-overview.mp4",
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/05-ai-email-generator.webm",
    finalVideoPath: "onboarding-videos/outputs/final/05-ai-email-generator.mp4",
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
    status: "raw_recorded",
    rawVideoPath: "onboarding-videos/outputs/raw/06-account-intelligence-view.webm",
    finalVideoPath: "onboarding-videos/outputs/final/06-account-intelligence-view.mp4",
    storyboardPath: "onboarding-videos/storyboards/06-account-intelligence-view.md",
  },
  {
    id: "cap-01",
    number: "07",
    title: "Capital Module Overview",
    description:
      "A tour of the Capital command center — round progress, investor pipeline stages, and how sample data maps to the real fundraising workflow.",
    duration: "3:09",
    audiences: ["CFO"],
    status: "edited",
    rawVideoPath: "onboarding-videos/outputs/raw/cap-01-capital-overview.webm",
    finalVideoPath: "onboarding-videos/outputs/final/cap-01-capital-overview.mp4",
    storyboardPath: "onboarding-videos/storyboards/cap-01-capital-overview.md",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
  },
  {
    id: "cap-02",
    number: "08",
    title: "Investor Pipeline & Commitments",
    description:
      "How to move investors through pipeline stages, log soft circles and commitments, and read the round's committed vs. target progress.",
    duration: "3:06",
    audiences: ["CFO"],
    status: "edited",
    rawVideoPath: "onboarding-videos/outputs/raw/cap-02-investor-pipeline.webm",
    finalVideoPath: "onboarding-videos/outputs/final/cap-02-investor-pipeline.mp4",
    storyboardPath: "onboarding-videos/storyboards/cap-02-investor-pipeline.md",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
  },
  {
    id: "cap-03",
    number: "09",
    title: "Data Room & Materials",
    description:
      "Organizing diligence materials into folders, marking confidentiality, and sharing a data room with an investor via the investor portal.",
    duration: "3:09",
    audiences: ["CFO"],
    status: "edited",
    rawVideoPath: "onboarding-videos/outputs/raw/cap-03-data-room.webm",
    finalVideoPath: "onboarding-videos/outputs/final/cap-03-data-room.mp4",
    storyboardPath: "onboarding-videos/storyboards/cap-03-data-room.md",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
  },
  {
    id: "cap-04",
    number: "10",
    title: "Follow-Ups & Engagement Tracking",
    description:
      "Creating and assigning investor follow-ups, and reading the engagement log to see who's warm and who's gone quiet.",
    duration: "3:05",
    audiences: ["CFO"],
    status: "edited",
    rawVideoPath: "onboarding-videos/outputs/raw/cap-04-followups-engagement.webm",
    finalVideoPath: "onboarding-videos/outputs/final/cap-04-followups-engagement.mp4",
    storyboardPath: "onboarding-videos/storyboards/cap-04-followups-engagement.md",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
  },
  {
    id: "cap-05",
    number: "11",
    title: "Reports & the AI Copilot",
    description:
      "Generating weekly briefs, board updates, and CFO closing reports, plus how to use the Capital AI Copilot for quick investor Q&A.",
    duration: "3:05",
    audiences: ["CFO"],
    status: "edited",
    rawVideoPath: "onboarding-videos/outputs/raw/cap-05-reports-copilot.webm",
    finalVideoPath: "onboarding-videos/outputs/final/cap-05-reports-copilot.mp4",
    storyboardPath: "onboarding-videos/storyboards/cap-05-reports-copilot.md",
    restrictedToEmails: ["trevor@voltsafe.com", "scott@voltsafe.com", "scott.carlson@voltsafe.com"],
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
