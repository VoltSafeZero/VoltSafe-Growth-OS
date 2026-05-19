import { useState, useCallback, useEffect } from "react";

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type Snippet = {
  id: string;
  title: string;
  category: string;
  subject: string;
  body: string;
};

export type ActiveContact = {
  firstName?: string;
  lastName?: string;
  marinaName?: string;
  companyName?: string;
  email?: string;
};

/* ─── Storage key ────────────────────────────────────────────────────────── */

export const SNIPPETS_STORAGE_KEY = "voltsafe_mail_snippets_v1";

/* ─── Default snippets ──────────────────────────────────────────────────── */

export const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: "ds-thanks-reaching-out",
    title: "Thanks for Reaching Out",
    category: "Quick Replies",
    subject: "Appreciate the note",
    body: `Hi {{firstName}},\n\nThanks for reaching out.\n\nAppreciate the interest in VoltSafe Marine. We're building a fully integrated dock-to-dashboard shore power platform designed to modernize one of the most overlooked parts of marina infrastructure.\n\nIn short:\nSafer connections. Smarter management. Lower operational friction.\n\nHappy to answer questions or set up a short intro call if useful.\n\nTrevor`,
  },
  {
    id: "ds-schedule-call",
    title: "Schedule a Call",
    category: "Quick Replies",
    subject: "Worth a quick conversation?",
    body: `Hi {{firstName}},\n\nHappy to connect.\n\nHere's my calendar if easier:\n{{calendarLink}}\n\nNo formal pitch deck needed unless useful. Usually best to start with what problems your team is actively trying to solve at the dock level.\n\nTrevor`,
  },
  {
    id: "ds-cold-1",
    title: "Cold Email 1 - Marina Hook",
    category: "Cold Outreach",
    subject: "The marina industry quietly has a shore power problem",
    body: `Hi {{firstName}},\n\nA strange question:\n\nWhy are marinas still relying on 140-year-old plug technology for mission-critical electrical infrastructure?\n\nMost shore power systems still arc, corrode, trip breakers, require constant maintenance, create liability exposure, and don't actually know what they're connected to.\n\nVoltSafe changes that.\n\nWe've built the first fully integrated dock-to-dashboard shore power platform:\n\n• Prongless magnetic shore power connectors (no exposed live metal)\n• Real-time current leakage and fault detection\n• Automated metered billing per slip\n• Remote monitoring and predictive maintenance\n• Boater mobile controls and marina management dashboard\n\nAll in one native system — not a patchwork of vendor integrations.\n\nWould it be worth 20 minutes to show you what forward-thinking marinas are moving toward?\n\nTrevor`,
  },
  {
    id: "ds-cold-2",
    title: "Cold Email 2 - Social Proof",
    category: "Cold Outreach",
    subject: "VoltSafe has been getting attention for a reason",
    body: `Hi {{firstName}},\n\nQuick follow up.\n\nThe response from marina operators has exceeded expectations.\n\nA few reasons:\nElectrical compliance pressure is increasing.\nInsurance concerns are growing.\nOperators are tired of smart marina Franken-systems patched together from multiple vendors.\nBoaters increasingly expect connected infrastructure.\n\nVoltSafe consolidates all of it into one native system: pedestal, connectors, monitoring, billing, CRM, and boater controls.\n\nWorth a quick call to see if the timing makes sense for {{marinaName}}?\n\nTrevor`,
  },
  {
    id: "ds-cold-3",
    title: "Cold Email 3 - Operational Pain",
    category: "Cold Outreach",
    subject: "Most marina electrical issues start at the point of connection",
    body: `Hi {{firstName}},\n\nInteresting thing about shore power:\n\nThe highest-risk part of the system is usually the most ignored part.\n\nTraditional shore power connectors were never designed for modern electrical loads, smart infrastructure, remote management, electrified marinas, or predictive diagnostics.\n\nThat's why operators constantly deal with hidden corrosion, nuisance breaker trips, overheating, leakage current issues, damaged pedestals, and emergency troubleshooting with no visibility into what actually happened.\n\nVoltSafe eliminates the root cause — not just the symptoms.\n\nHappy to walk through what that looks like operationally.\n\nTrevor`,
  },
  {
    id: "ds-cold-4",
    title: "Cold Email 4 - Early Access",
    category: "Cold Outreach",
    subject: "We're limiting early marina deployments",
    body: `Hi {{firstName}},\n\nAs we move through certification and commercial rollout, we're being selective with early deployments.\n\nReason is simple:\nWe'd rather support a smaller number of forward-thinking marinas exceptionally well than overextend too early.\n\nWe're currently prioritizing innovative operators, groups modernizing infrastructure, marinas focused on premium customer experience, and facilities looking to future-proof electrical infrastructure.\n\nThe early cohort also gets priority pricing, direct product team access, and visibility as a launch partner.\n\nWorth a conversation to see if {{marinaName}} fits the profile?\n\nTrevor`,
  },
  {
    id: "ds-cold-5",
    title: "Cold Email 5 - Breakup",
    category: "Cold Outreach",
    subject: "Close the file?",
    body: `Hi {{firstName}},\n\nTotally understand timing may not be right.\n\nThe marina industry moves carefully for good reason.\n\nThat said, we're seeing a noticeable shift toward smarter, software-connected shore power infrastructure as compliance, insurance, and operational pressure increases.\n\nI'll close the loop for now, but happy to reconnect anytime if modernizing shore power becomes a priority.\n\nEither way, appreciate the consideration.\n\nTrevor`,
  },
  {
    id: "ds-post-demo",
    title: "Post Demo Follow Up",
    category: "Follow Ups",
    subject: "Great connecting today",
    body: `Hi {{firstName}},\n\nAppreciate you taking the time today.\n\nAlways valuable hearing directly from operators dealing with the realities of dock infrastructure every day.\n\nAs discussed, VoltSafe is not just a pedestal replacement.\n\nIt's a fully integrated operational platform designed to improve safety, visibility, billing accuracy, maintenance efficiency, boater experience, and future scalability.\n\nAttached are the relevant materials.\n\nA few marinas are currently in advanced deployment planning. Happy to keep {{marinaName}} in the priority conversation as we finalize the early cohort.\n\nTrevor`,
  },
  {
    id: "ds-founder-marina",
    title: "Founder Marina Opportunity",
    category: "Founder Marina",
    subject: "Founder Marina opportunity",
    body: `Hi {{firstName}},\n\nWe're currently finalizing a limited number of VoltSafe Founder Marina relationships ahead of broader commercialization.\n\nThese early partners gain priority deployment access, early pricing advantages, direct collaboration with our product team, strategic visibility opportunities, and early ecosystem influence.\n\nReality is:\nOnce wider rollout begins, this window closes.\n\nWe're intentionally keeping this group small.\n\nHappy to walk you through what the Founder Marina relationship looks like and whether it makes sense for {{marinaName}}.\n\nTrevor`,
  },
  {
    id: "ds-soft-po",
    title: "Soft PO to Hard PO",
    category: "PO Conversion",
    subject: "Securing deployment priority",
    body: `Hi {{firstName}},\n\nAs discussed, we're now organizing deployment planning and manufacturing allocation for upcoming marina installations.\n\nTo support forecasting and delivery prioritization, we're working with marina groups through Letters of Intent, Reservation Agreements, Soft Purchase Orders, Conditional Purchase Orders, and deployment planning agreements.\n\nThis helps secure queue position, support manufacturing planning, prioritize delivery scheduling, and lock in early pricing.\n\nHappy to walk through what makes the most sense for {{marinaName}} at this stage.\n\nTrevor`,
  },
  {
    id: "ds-international",
    title: "International Interest",
    category: "International",
    subject: "Thank you for your interest in VoltSafe",
    body: `Hi {{firstName}},\n\nThank you for reaching out.\n\nVoltSafe Marine completely rethinks how shore power is delivered: safer, smarter, and frictionless for marina operators and boaters alike.\n\nOur integrated platform combines magnetic prongless shore power, Marina Command Dashboard, automated billing, current leakage monitoring, predictive maintenance, and boater mobile controls.\n\nAt the moment, our commercialization focus is North America as we complete launch activities and certification rollout.\n\nThat said, we're tracking international interest carefully and happy to stay connected as our geographic expansion plans develop.\n\nAppreciate the outreach.\n\nTrevor`,
  },
  {
    id: "ds-dealer",
    title: "Dealer Inquiry",
    category: "Dealer / Partner",
    subject: "Re: VoltSafe Marine dealer inquiry",
    body: `Hi {{firstName}},\n\nAppreciate the interest in VoltSafe Marine.\n\nAt present, we're managing deployment and distribution internally as we move through early commercialization and certification rollout.\n\nThat said, we absolutely recognize the importance of strategic dealer and channel relationships longer term.\n\nI've shared your information internally so we can stay connected as our distribution strategy evolves.\n\nAppreciate the outreach.\n\nTrevor`,
  },
  {
    id: "ds-ghost-followup",
    title: "Ghost Follow Up",
    category: "Re-Engagement",
    subject: "Still on your radar?",
    body: `Hi {{firstName}},\n\nJust checking in.\n\nWe've continued making strong progress on certification, deployments, and manufacturing readiness.\n\nCurious if shore power modernization is still something {{marinaName}} is exploring this season or next.\n\nHappy to reconnect anytime.\n\nTrevor`,
  },
  {
    id: "ds-delivery-urgency",
    title: "Delivery Window Urgency",
    category: "Urgency",
    subject: "Planning ahead for deployment timing",
    body: `Hi {{firstName}},\n\nWorth noting:\n\nMost marinas don't modernize infrastructure at the last second.\n\nPlanning cycles, electrical reviews, budgeting, dock schedules, procurement, and seasonal timing all stack together quickly.\n\nAs commercialization ramps, delivery prioritization will increasingly favor operators already engaged in planning conversations and reservation pathways.\n\nNot intended as pressure.\nJust operational reality.\n\nTrevor`,
  },
  {
    id: "ds-why-voltsafe",
    title: "Why VoltSafe",
    category: "Brand",
    subject: "Why VoltSafe exists",
    body: `Hi {{firstName}},\n\nMost people never question the electrical plug.\n\nBut they should.\n\nThe plug system the world still relies on was designed in the 1800s before modern electrification, automation, EVs, smart infrastructure, or connected systems even existed.\n\nYet today we still accept arcing, corrosion, overheating, fire risk, and exposed energized metal as somehow normal.\n\nVoltSafe exists because good enough is no longer good enough.\n\nWe believe electrical connections should be inherently safe, inherently smart, and inherently connected.\n\nThat conviction is built into everything we make.\n\nTrevor`,
  },
];

/* ─── loadSnippets ───────────────────────────────────────────────────────── */

export function loadSnippets(): Snippet[] {
  if (typeof window === "undefined") return DEFAULT_SNIPPETS;
  try {
    const raw = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (!raw) return DEFAULT_SNIPPETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SNIPPETS;
    return parsed
      .filter(
        (s) =>
          s &&
          typeof s.id === "string" &&
          typeof (s.title ?? s.name) === "string" &&
          typeof s.body === "string",
      )
      .map((s) => ({
        id: s.id,
        title: s.title ?? s.name ?? "",
        category: s.category ?? "Custom",
        subject: s.subject ?? "",
        body: s.body,
      }));
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

/* ─── useSnippets ────────────────────────────────────────────────────────── */

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());

  useEffect(() => {
    try {
      localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
    } catch {}
  }, [snippets]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SNIPPETS_STORAGE_KEY) setSnippets(loadSnippets());
    };
    const onCustom = () => setSnippets(loadSnippets());
    window.addEventListener("storage", onStorage);
    window.addEventListener("voltsafe.snippets.changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("voltsafe.snippets.changed", onCustom as EventListener);
    };
  }, []);

  const broadcast = () => {
    try {
      window.dispatchEvent(new Event("voltsafe.snippets.changed"));
    } catch {}
  };

  const upsert = useCallback((snippet: Snippet) => {
    setSnippets((prev) => {
      const idx = prev.findIndex((s) => s.id === snippet.id);
      return idx >= 0
        ? prev.map((s, i) => (i === idx ? snippet : s))
        : [...prev, snippet];
    });
    setTimeout(broadcast, 0);
  }, []);

  const remove = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    setTimeout(broadcast, 0);
  }, []);

  return { snippets, upsert, remove };
}
