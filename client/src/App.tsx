import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { Search } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/dashboard/header";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { GlobalCreateContact } from "@/components/contacts/global-create-contact";
import { isAdvisorRole } from "@/lib/nav-config";
import BookingPublicPage from "@/pages/booking-public";
import { UpcomingMeetingBanner } from "@/components/dashboard/upcoming-meeting-banner";

import Dashboard from "@/pages/dashboard";
import CommandCenter from "@/pages/command-center";
import DailyCommandCenter from "@/pages/daily-command-center";
import RoleCommandCenter from "@/pages/role-command-center";
import TodayPage from "@/pages/today";
import PipelinePage from "@/pages/pipeline";
import MarinasPage from "@/pages/marinas";
import LeadsPage from "@/pages/leads";
import AccountsPage from "@/pages/accounts";
import ContactsPage from "@/pages/contacts";
import QuotesPage from "@/pages/quotes";
import TicketsPage from "@/pages/tickets";
import CommunicationsPage from "@/pages/communications";
import SettingsPage from "@/pages/settings";
import TeamWorkloadPage from "@/pages/team-workload";
import PartnershipsPage from "@/pages/partnerships";
import EcosystemOrganizationsPage from "@/pages/ecosystem-organizations";
import EcosystemPeoplePage from "@/pages/ecosystem-people";
import EcosystemRelationshipsPage from "@/pages/ecosystem-relationships";
import EcosystemEventsPage from "@/pages/ecosystem-events";
import EcosystemRegionsPage from "@/pages/ecosystem-regions";
import CalendarPage from "@/pages/calendar";
import LoginPage from "@/pages/login";
import ChangePasswordPage from "@/pages/change-password";
import NotFound from "@/pages/not-found";
import { VoiceAssistant } from "@/components/voice-assistant";
import { QuickCapture } from "@/components/quick-capture";
import GmailInboxPage from "@/pages/gmail-inbox";
import { InboxFullScreenShell } from "@/components/inbox/inbox-fullscreen-shell";
import AssetsPage from "@/pages/assets";
import PriceListsPage from "@/pages/price-lists";
import JiraPage from "@/pages/jira";
import ConfluencePage from "@/pages/confluence";
import AdminIntegrationsPage from "@/pages/admin-integrations";
import AdminUsersPage from "@/pages/admin-users";
import ProjectsPage from "@/pages/projects";
import ResetPasswordPage from "@/pages/reset-password";
import RelationshipIntelligencePage from "@/pages/relationship-intelligence";
import ContactProfilePage from "@/pages/contact-profile";
import AccountProfilePage from "@/pages/account-profile";
import OpportunityProfilePage from "@/pages/opportunity-profile";
import BookingOutreachPage from "@/pages/booking-outreach";
import BookingAnalyticsPage from "@/pages/booking-analytics";
import ActivityFeedPage from "@/pages/activity-feed";
import NotesPage from "@/pages/notes-page";
import TasksHubPage from "@/pages/tasks-hub";
import TaskRulesSettingsPage from "@/pages/task-rules-settings";
import DailyExecutionPage from "@/pages/daily-execution";
import DataQualityPage from "@/pages/data-quality";
import InstallWorkflowsPage from "@/pages/install-workflows";
import SourceAttributionPage from "@/pages/source-attribution";
import ExecutiveDashboardPage from "@/pages/executive-dashboard";
import ProcurementPage from "@/pages/procurement";
import DeploymentsPage from "@/pages/deployments";
import RenewalsPage from "@/pages/renewals";
import GeographyPage from "@/pages/geography";
import DocumentsPage from "@/pages/documents";
import AutomationsPage from "@/pages/automations";
import BoardPackPage from "@/pages/board-pack";
import RevenuePage from "@/pages/revenue";
import RevenueSimPage from "@/pages/revenue-sim";
import RevenueOpsPage from "@/pages/revenue-ops";
import WinterHubPage from "@/pages/winter-hub";
import ExecutiveCopilotPage from "@/pages/executive-copilot";
import FieldPage from "@/pages/field";
import FieldNearbyPage from "@/pages/field-nearby";
import AlertsDigestPage from "@/pages/alerts-digest";
import ScoreFeedbackPage from "@/pages/score-feedback";
import TerritoryRoutingPage from "@/pages/territory-routing";
import MailboxSettingsPage from "@/pages/mailbox-settings";
import MailboxHealthPage from "@/pages/mailbox-health";
import HelpCenterPage from "@/pages/help-center";
import MeetingNotesIndexPage from "@/pages/meeting-notes-index";
import MeetingNotesDetailPage from "@/pages/meeting-notes-detail";
import { GlobalSearch } from "@/components/global-search";
import { DemonAtmospherics } from "@/components/demon-atmospherics";

type AccessLevel = "none" | "view" | "edit";

export type UserPermissions = {
  crm: AccessLevel;
  partnerships: AccessLevel;
  projects: AccessLevel;
  communications: AccessLevel;
  team_workload: AccessLevel;
  knowledge: AccessLevel;
  support: AccessLevel;
  quoting: AccessLevel;
  calendar: AccessLevel;
  mail_team: Record<string, { view: boolean; edit: boolean }>;
  calendar_team: number[];
};

export const FULL_PERMISSIONS: UserPermissions = {
  crm: "edit", partnerships: "edit", projects: "edit",
  communications: "edit", team_workload: "edit", knowledge: "edit",
  support: "edit", quoting: "edit", calendar: "edit",
  mail_team: {}, calendar_team: [],
};

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  globalRole: string;
  status: string;
  mustChangePassword: boolean;
  permissions: UserPermissions;
  department?: string | null;
  jobTitle?: string | null;
  userType?: string;
  preferredLayout?: string;
  widgetVisibility?: Record<string, boolean>;
  defaultCommandCenter?: string | null;
};

function isAdmin(role: string) {
  return ["master_admin", "admin"].includes(role);
}

function hasAccess(perms: UserPermissions, globalRole: string, section: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">): boolean {
  if (isAdmin(globalRole)) return true;
  return (perms[section] ?? "edit") !== "none";
}

function AccessDenied() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
      <p className="text-muted-foreground text-sm mb-6 max-w-sm">You don't have permission to view this section. Contact your admin to request access.</p>
      <button onClick={() => navigate("/")} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
        Go to Dashboard
      </button>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return null;
}

function AppShell({ children, user, onLogout }: { children: React.ReactNode; user: AuthUser; onLogout: () => void }) {
  const sidebarStyle = { "--sidebar-width": "16rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties;
  return (
    <SidebarProvider style={sidebarStyle}>
      {/*
        DemonAtmospherics renders fixed-position SVG environmental layers
        (vines, thorns, cracks) BEHIND the app shell when a demon theme is
        active. Returns null for light/dark — zero cost when not in a demon
        theme. The shell wrapper below is forced transparent under demon
        themes via index.css so these layers are actually visible.
      */}
      <DemonAtmospherics />
      <div data-app-shell="root" className="flex h-screen w-full bg-background text-foreground overflow-hidden">
        <div className="hidden md:flex">
          <AppSidebar userGlobalRole={user.globalRole || "sales"} userPermissions={user.permissions ?? FULL_PERMISSIONS} />
        </div>
        <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
          <Header user={user} onLogout={onLogout} />
          {/*
            Main is the single scroll container for the app.
            - flex flex-col + min-h-0 give descendant pages a usable height context
              so `flex-1`/`h-full` fill the viewport reliably and reflow on resize.
            - pb-20 md:pb-0 is just enough mobile clearance for MobileNav; on
              desktop we don't reserve dead space at the bottom anymore.
          */}
          <main className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden relative scroll-smooth pb-20 md:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav userGlobalRole={user.globalRole || "sales"} />
      <GlobalCreateContact />
    </SidebarProvider>
  );
}

function AuthenticatedRouter({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const perms = user.permissions ?? FULL_PERMISSIONS;
  const role = user.globalRole || "sales";
  const isAdvisor = isAdvisorRole(role);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appLocation] = useLocation();

  // ⌘K opens GlobalSearch app-wide, EXCEPT on the inbox page where the inbox
  // command palette owns ⌘K. The inbox handler also calls
  // stopImmediatePropagation in capture phase as a belt-and-suspenders guard.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "k")) return;
      // Route-based gate — skip on inbox routes so the inbox cmdk wins cleanly
      const path = window.location.pathname || "";
      if (path.startsWith("/inbox") || path.startsWith("/gmail")) return;
      e.preventDefault();
      setSearchOpen(v => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [appLocation]);

  function wrap(children: React.ReactNode) {
    return (
      <>
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        <AppShell user={user} onLogout={onLogout}>{children}</AppShell>
      </>
    );
  }

  function guard(section: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">, children: React.ReactNode) {
    return wrap(hasAccess(perms, role, section) ? children : <AccessDenied />);
  }

  function advisorBlock(children: React.ReactNode) {
    return wrap(isAdvisor ? <AccessDenied /> : children);
  }

  return (
    <Switch>
      <Route path="/">{() => wrap(<RoleCommandCenter />)}</Route>
      <Route path="/command-center">{() => wrap(<CommandCenter />)}</Route>
      <Route path="/dashboard">{() => wrap(<Dashboard />)}</Route>
      <Route path="/today">{() => wrap(<TodayPage />)}</Route>
      <Route path="/field/nearby">{() => wrap(<FieldNearbyPage />)}</Route>
      <Route path="/field">{() => wrap(<FieldPage />)}</Route>
      <Route path="/pipeline">{() => guard("crm", isAdvisor ? <AccessDenied /> : <PipelinePage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/data-quality">{() => guard("crm", isAdvisor ? <AccessDenied /> : <DataQualityPage />)}</Route>
      <Route path="/install-workflows">{() => guard("crm", isAdvisor ? <AccessDenied /> : <InstallWorkflowsPage />)}</Route>
      <Route path="/analytics/source-attribution">{() => guard("crm", isAdvisor ? <AccessDenied /> : <SourceAttributionPage />)}</Route>
      <Route path="/executive-dashboard">{() => guard("crm", isAdvisor ? <AccessDenied /> : <ExecutiveDashboardPage />)}</Route>
      <Route path="/procurement">{() => guard("crm", isAdvisor ? <AccessDenied /> : <ProcurementPage />)}</Route>
      <Route path="/deployments">{() => guard("crm", isAdvisor ? <AccessDenied /> : <DeploymentsPage />)}</Route>
      <Route path="/renewals">{() => guard("crm", isAdvisor ? <AccessDenied /> : <RenewalsPage />)}</Route>
      <Route path="/geography">{() => guard("crm", isAdvisor ? <AccessDenied /> : <GeographyPage />)}</Route>
      <Route path="/routing">{() => advisorBlock(<TerritoryRoutingPage />)}</Route>
      <Route path="/documents">{() => wrap(<DocumentsPage />)}</Route>

      {/* ── Sidebar alias routes — each nav item gets a unique URL so active   */}
      {/* ── state never leaks across sections (no shared paths between items). */}
      <Route path="/execution/forecast">{() => guard("crm", isAdvisor ? <AccessDenied /> : <PipelinePage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/revenue/deals">{() => guard("crm", isAdvisor ? <AccessDenied /> : <LeadsPage canEdit={isAdmin(role) || perms.crm === "edit"} lockedStatus="converted" pageTitle="Accounts Won" />)}</Route>
      <Route path="/intelligence/briefs">{() => wrap(<TodayPage />)}</Route>
      <Route path="/intelligence/signals">{() => wrap(<ActivityFeedPage />)}</Route>
      <Route path="/intelligence/rel-intelligence">{() => wrap(<RelationshipIntelligencePage />)}</Route>

      {/* ── Growth OS: Relationships ───────────────────────────────── */}
      <Route path="/accounts/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <AccountProfilePage />)}</Route>
      <Route path="/accounts">{() => guard("crm", isAdvisor ? <AccessDenied /> : <AccountsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/contacts/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <ContactProfilePage />)}</Route>
      <Route path="/contacts">{() => guard("crm", isAdvisor ? <AccessDenied /> : <ContactsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/opportunities/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <OpportunityProfilePage />)}</Route>
      <Route path="/opportunities">{() => guard("crm", isAdvisor ? <AccessDenied /> : <LeadsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/quotes">{() => guard("quoting", isAdvisor ? <AccessDenied /> : <QuotesPage canEdit={isAdmin(role) || perms.quoting === "edit"} />)}</Route>
      <Route path="/booking-outreach">{() => guard("crm", isAdvisor ? <AccessDenied /> : <BookingOutreachPage />)}</Route>
      <Route path="/booking-analytics">{() => guard("crm", isAdvisor ? <AccessDenied /> : <BookingAnalyticsPage />)}</Route>

      {/* ── Growth OS: Coming Soon stubs ──────────────────────────── */}
      <Route path="/activity">{() => wrap(<ActivityFeedPage />)}</Route>
      <Route path="/notes">{() => wrap(<NotesPage />)}</Route>
      <Route path="/meeting-notes/:id">{(params) => wrap(<MeetingNotesDetailPage params={params as { id: string }} />)}</Route>
      <Route path="/meeting-notes">{() => wrap(<MeetingNotesIndexPage />)}</Route>
      {(["renewals", "segments", "tags", "imports"] as const).map(slug => (
        <Route key={slug} path={`/${slug}`}>{() => wrap(
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold capitalize">{slug.replace(/-/g, " / ")}</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">This Growth OS module is coming soon. Your data and settings will appear here.</p>
            </div>
          </div>
        )}</Route>
      ))}

      {/* ── STRATEGY ──────────────────────────────────────────────── */}
      <Route path="/strategy/partnerships/:typeSlug">{(params) => guard("partnerships", isAdvisor ? <AccessDenied /> : <PartnershipsPage typeSlug={(params as any)?.typeSlug || ""} canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/partnerships">{() => guard("partnerships", isAdvisor ? <AccessDenied /> : <PartnershipsPage typeSlug="" canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/industry">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/oem">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/government">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/research">{() => <Redirect to="/strategy/partnerships" />}</Route>

      {/* ── EXECUTION ─────────────────────────────────────────────── */}
      <Route path="/gmail">{() => (
        <InboxFullScreenShell>
          <GmailInboxPage currentUserEmail={user.email} currentUserRole={user.globalRole || "sales"} userPermissions={perms} />
        </InboxFullScreenShell>
      )}</Route>
      <Route path="/relationships">{() => wrap(<RelationshipIntelligencePage />)}</Route>
      <Route path="/execution/calendar">{() => guard("calendar", <CalendarPage permissions={perms} currentUserId={user.id} isAdmin={isAdmin(role)} />)}</Route>
      <Route path="/execution/projects">{() => guard("projects", <ProjectsPage />)}</Route>
      <Route path="/execution/communications">{() => guard("communications", isAdvisor ? <AccessDenied /> : <CommunicationsPage />)}</Route>
      <Route path="/execution/team-workload">{() => guard("team_workload", <TeamWorkloadPage />)}</Route>
      <Route path="/execution/tasks">{() => wrap(<TasksHubPage />)}</Route>

      {/* ── KNOWLEDGE ─────────────────────────────────────────────── */}
      <Route path="/knowledge/assets">{() => guard("knowledge", <AssetsPage />)}</Route>
      <Route path="/price-lists">{() => guard("quoting", isAdvisor ? <AccessDenied /> : <PriceListsPage />)}</Route>

      {/* ── SUPPORT ───────────────────────────────────────────────── */}
      <Route path="/support/tickets">{() => guard("support", <TicketsPage canEdit={isAdmin(role) || perms.support === "edit"} />)}</Route>

      {/* ── REPORTS ───────────────────────────────────────────────── */}
      <Route path="/board-pack">{() => wrap(<BoardPackPage />)}</Route>
      <Route path="/revenue">{() => advisorBlock(<RevenuePage />)}</Route>
      <Route path="/revenue-sim">{() => advisorBlock(<RevenueSimPage />)}</Route>
      <Route path="/revenue-ops">{() => advisorBlock(<RevenueOpsPage />)}</Route>
      <Route path="/winter">{() => wrap(<WinterHubPage />)}</Route>
      <Route path="/executive-copilot">{() => wrap(<ExecutiveCopilotPage />)}</Route>

      {/* ── AUTOMATION ────────────────────────────────────────────── */}
      <Route path="/automations">{() => wrap(<AutomationsPage />)}</Route>
      <Route path="/automation/tasks">{() => wrap(<TaskRulesSettingsPage />)}</Route>
      <Route path="/execution/daily">{() => wrap(<DailyExecutionPage />)}</Route>

      {/* ── ADMIN ─────────────────────────────────────────────────── */}
      <Route path="/admin/users">{() => wrap(<AdminUsersPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/admin/integrations">{() => wrap(<AdminIntegrationsPage />)}</Route>
      <Route path="/jira">{() => wrap(<JiraPage />)}</Route>
      <Route path="/confluence">{() => wrap(<ConfluencePage />)}</Route>
      <Route path="/help">{() => wrap(<HelpCenterPage />)}</Route>
      <Route path="/settings">{() => wrap(<SettingsPage />)}</Route>
      <Route path="/settings/mailbox">{() => wrap(<MailboxSettingsPage />)}</Route>
      <Route path="/settings/mailbox-health">{() => wrap(<MailboxHealthPage />)}</Route>
      <Route path="/search">{() => wrap(
        <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background">
          <div className="max-w-2xl w-full mx-auto px-4 py-8">
            <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Search className="w-6 h-6 text-primary" /> Global Search
            </h1>
            <p className="text-muted-foreground mb-4 text-sm">
              Use <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-xs">⌘K</kbd> anywhere to open the search modal instantly.
            </p>
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-secondary/30 hover:bg-secondary/60 transition-colors text-muted-foreground text-sm"
              data-testid="btn-open-search"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span>Search contacts, accounts, emails…</span>
              <kbd className="ml-auto bg-muted border border-border rounded px-1.5 py-0.5 text-xs">⌘K</kbd>
            </button>
          </div>
        </div>
      )}</Route>

      {/* ── LEGACY REDIRECTS ──────────────────────────────────────── */}
      <Route path="/tasks">{() => <Redirect to="/execution/tasks" />}</Route>
      <Route path="/leads">{() => <Redirect to="/opportunities" />}</Route>
      <Route path="/tickets">{() => <Redirect to="/support/tickets" />}</Route>
      <Route path="/calendar">{() => <Redirect to="/execution/calendar" />}</Route>
      <Route path="/communications">{() => <Redirect to="/execution/communications" />}</Route>
      <Route path="/team-workload">{() => <Redirect to="/execution/team-workload" />}</Route>
      <Route path="/assets">{() => <Redirect to="/knowledge/assets" />}</Route>
      <Route path="/integrations">{() => <Redirect to="/admin/integrations" />}</Route>
      <Route path="/partnerships/strategic-industry">{() => <Redirect to="/strategy/industry" />}</Route>
      <Route path="/partnerships/technology">{() => <Redirect to="/admin/integrations" />}</Route>
      <Route path="/partnerships/distribution">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/partnerships/oem">{() => <Redirect to="/strategy/oem" />}</Route>
      <Route path="/partnerships/government">{() => <Redirect to="/strategy/government" />}</Route>
      <Route path="/partnerships/research">{() => <Redirect to="/strategy/research" />}</Route>
      <Route path="/partnerships/pilot">{() => <Redirect to="/accounts" />}</Route>
      <Route path="/ecosystem/organizations">{() => wrap(<EcosystemOrganizationsPage />)}</Route>
      <Route path="/ecosystem/people">{() => wrap(<EcosystemPeoplePage />)}</Route>
      <Route path="/ecosystem/relationships">{() => wrap(<EcosystemRelationshipsPage />)}</Route>
      <Route path="/ecosystem/events">{() => wrap(<EcosystemEventsPage />)}</Route>
      <Route path="/ecosystem/regions">{() => wrap(<EcosystemRegionsPage />)}</Route>
      <Route path="/marinas">{() => wrap(<MarinasPage />)}</Route>
      <Route path="/alerts-digest">{() => wrap(<AlertsDigestPage />)}</Route>
      <Route path="/scores/feedback">{() => advisorBlock(<ScoreFeedbackPage />)}</Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setUser(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    queryClient.clear();
  };

  // Handle /reset-password?token=XXX before any auth checks
  const resetToken = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;
  const isResetPage = typeof window !== "undefined" && window.location.pathname === "/reset-password";

  if (isResetPage) {
    return (
      <ThemeProvider defaultTheme="dark">
        <ResetPasswordPage
          token={resetToken ?? ""}
          onLogin={(u) => setUser(u as unknown as AuthUser)}
        />
      </ThemeProvider>
    );
  }

  // Handle /book/:token — public booking page (no auth required)
  const bookingTokenMatch = typeof window !== "undefined"
    ? window.location.pathname.match(/^\/book\/([^/]+)$/)
    : null;
  if (bookingTokenMatch) {
    return (
      <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <BookingPublicPage token={bookingTokenMatch[1]} />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <ThemeProvider defaultTheme="dark">
        <LoginPage onLogin={(user) => setUser(user as unknown as AuthUser)} />
      </ThemeProvider>
    );
  }

  if (user.mustChangePassword) {
    return (
      <ThemeProvider defaultTheme="dark">
        <ChangePasswordPage onComplete={() => setUser({ ...user, mustChangePassword: false })} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AuthenticatedRouter user={user} onLogout={handleLogout} />
          <VoiceAssistant />
          <QuickCapture />
          <UpcomingMeetingBanner />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
