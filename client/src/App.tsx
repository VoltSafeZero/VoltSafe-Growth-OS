import { useState, useEffect, useRef, lazy, Suspense } from "react";

// ── Frontend first-load timing mark ──────────────────────────────────────────
// Fires as soon as the main app JS bundle has loaded and begun evaluating.
// startTime is relative to the page's navigation start (performance.timeOrigin).
if (typeof performance !== "undefined") {
  try { performance.mark("vs-js-loaded"); } catch {}
}
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
import { UpcomingMeetingBanner } from "@/components/dashboard/upcoming-meeting-banner";
import { DemoModeBanner } from "@/lib/demo-mode";
import { DemoCalloutOverlay } from "@/components/demo-callout";
import { ChunkErrorBoundary } from "@/components/chunk-error-boundary";
import { TimezoneContext, TimezoneContextValue, detectBrowserTimezone } from "@/lib/timezone";

// ── Lazy page imports — each route gets its own chunk ─────────────────────────
const Dashboard = lazy(() => import("@/pages/dashboard"));
const CommandCenter = lazy(() => import("@/pages/command-center"));
const DailyCommandCenter = lazy(() => import("@/pages/daily-command-center"));
const RoleCommandCenter = lazy(() => import("@/pages/role-command-center"));
const TodayPage = lazy(() => import("@/pages/today"));
const MyTravelPage = lazy(() => import("@/pages/my-travel"));
const TeamWorkCalendarPage = lazy(() => import("@/pages/team-work-calendar"));
const PipelinePage = lazy(() => import("@/pages/pipeline"));
const MarinasPage = lazy(() => import("@/pages/marinas"));
const LeadsPage = lazy(() => import("@/pages/leads"));
const AccountsPage = lazy(() => import("@/pages/accounts"));
const ContactsPage = lazy(() => import("@/pages/contacts"));
const QuotesPage = lazy(() => import("@/pages/quotes"));
const TicketsPage = lazy(() => import("@/pages/tickets"));
const CommunicationsPage = lazy(() => import("@/pages/communications"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const TeamWorkloadPage = lazy(() => import("@/pages/team-workload"));
const PartnershipsPage = lazy(() => import("@/pages/partnerships"));
const EcosystemOrganizationsPage = lazy(() => import("@/pages/ecosystem-organizations"));
const EcosystemPeoplePage = lazy(() => import("@/pages/ecosystem-people"));
const EcosystemRelationshipsPage = lazy(() => import("@/pages/ecosystem-relationships"));
const EcosystemEventsPage = lazy(() => import("@/pages/ecosystem-events"));
const TradeshowEventsPage = lazy(() => import("@/pages/tradeshow-events"));
const EcosystemRegionsPage = lazy(() => import("@/pages/ecosystem-regions"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const LoginPage = lazy(() => import("@/pages/login"));
const ChangePasswordPage = lazy(() => import("@/pages/change-password"));
const NotFound = lazy(() => import("@/pages/not-found"));
const VoiceAssistant = lazy(() => import("@/components/voice-assistant").then(m => ({ default: m.VoiceAssistant })));
const QuickCapture = lazy(() => import("@/components/quick-capture").then(m => ({ default: m.QuickCapture })));
const GmailInboxPage = lazy(() => import("@/pages/gmail-inbox"));
const InboxFullScreenShell = lazy(() => import("@/components/inbox/inbox-fullscreen-shell").then(m => ({ default: m.InboxFullScreenShell })));
const AssetsPage = lazy(() => import("@/pages/assets"));
const PriceListsPage = lazy(() => import("@/pages/price-lists"));
const JiraPage = lazy(() => import("@/pages/jira"));
const ConfluencePage = lazy(() => import("@/pages/confluence"));
const AdminIntegrationsPage = lazy(() => import("@/pages/admin-integrations"));
const AdminUsersPage = lazy(() => import("@/pages/admin-users"));
const AdminTaskAccessPage = lazy(() => import("@/pages/admin-task-access"));
const AdminSignaturesPage = lazy(() => import("@/pages/admin-signatures"));
const AdminRolesPage = lazy(() => import("@/pages/admin-roles"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password"));
const UnsubscribePage = lazy(() => import("@/pages/unsubscribe"));
const PreferencesPage = lazy(() => import("@/pages/preferences"));
const ComplianceUnsubscribePage = lazy(() => import("@/pages/unsubscribe-compliance"));
const RelationshipIntelligencePage = lazy(() => import("@/pages/relationship-intelligence"));
const ContactProfilePage = lazy(() => import("@/pages/contact-profile"));
const AccountProfilePage = lazy(() => import("@/pages/account-profile"));
const OpportunityProfilePage = lazy(() => import("@/pages/opportunity-profile"));
const BookingOutreachPage = lazy(() => import("@/pages/booking-outreach"));
const BookingAnalyticsPage = lazy(() => import("@/pages/booking-analytics"));
const RevenueIntelligencePage = lazy(() => import("@/pages/revenue-intelligence"));
const ActivityFeedPage = lazy(() => import("@/pages/activity-feed"));
const NotesPage = lazy(() => import("@/pages/notes-page"));
const TasksHubPage = lazy(() => import("@/pages/tasks-hub"));
const TaskRulesSettingsPage = lazy(() => import("@/pages/task-rules-settings"));
const DailyExecutionPage = lazy(() => import("@/pages/daily-execution"));
const DataQualityPage = lazy(() => import("@/pages/data-quality"));
const InstallWorkflowsPage = lazy(() => import("@/pages/install-workflows"));
const SourceAttributionPage = lazy(() => import("@/pages/source-attribution"));
const ExecutiveDashboardPage = lazy(() => import("@/pages/executive-dashboard"));
const ProcurementPage = lazy(() => import("@/pages/procurement"));
const DeploymentsPage = lazy(() => import("@/pages/deployments"));
const RenewalsPage = lazy(() => import("@/pages/renewals"));
const GeographyPage = lazy(() => import("@/pages/geography"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const AutomationsPage = lazy(() => import("@/pages/automations"));
const BoardPackPage = lazy(() => import("@/pages/board-pack"));
const RevenuePage = lazy(() => import("@/pages/revenue"));
const RevenueSimPage = lazy(() => import("@/pages/revenue-sim"));
const RevenueOpsPage = lazy(() => import("@/pages/revenue-ops"));
const WinterHubPage = lazy(() => import("@/pages/winter-hub"));
const ExecutiveCopilotPage = lazy(() => import("@/pages/executive-copilot"));
const CortexIntelLibraryPage = lazy(() => import("@/pages/cortex-intel-library"));
const FieldPage = lazy(() => import("@/pages/field"));
const FieldNearbyPage = lazy(() => import("@/pages/field-nearby"));
const AlertsDigestPage = lazy(() => import("@/pages/alerts-digest"));
const ScoreFeedbackPage = lazy(() => import("@/pages/score-feedback"));
const TerritoryRoutingPage = lazy(() => import("@/pages/territory-routing"));
const MailboxSettingsPage = lazy(() => import("@/pages/mailbox-settings"));
const MailboxHealthPage = lazy(() => import("@/pages/mailbox-health"));
const SignatureSettingsPage = lazy(() => import("@/pages/signature-settings"));
const AiVoiceProfilesPage = lazy(() => import("@/pages/ai-voice-profiles"));
const HelpCenterPage = lazy(() => import("@/pages/help-center"));
const TrainingHubPage = lazy(() => import("@/pages/training-hub"));
const MeetingNotesIndexPage = lazy(() => import("@/pages/meeting-notes-index"));
const MeetingNotesDetailPage = lazy(() => import("@/pages/meeting-notes-detail"));
const CurrentPage = lazy(() => import("@/pages/current"));
const CurrentsWorkspaceShell = lazy(() =>
  import("@/components/currents/currents-workspace-shell").then(m => ({ default: m.CurrentsWorkspaceShell }))
);
const MarketingEngagementPage = lazy(() => import("@/pages/marketing-engagement"));
const PersonalSettingsPage    = lazy(() => import("@/pages/settings-personal"));
const MarketingDashboardPage = lazy(() => import("@/pages/marketing-dashboard"));
const MarketingCampaignsPage = lazy(() => import("@/pages/marketing-campaigns"));
const MarketingAudiencesPage = lazy(() => import("@/pages/marketing-audiences"));
const MarketingTemplatesPage = lazy(() => import("@/pages/marketing-templates"));
const MarketingAnalyticsPage = lazy(() => import("@/pages/marketing-analytics"));
const MarketingSuppressionPage = lazy(() => import("@/pages/marketing-suppression"));
const MarketingRepliesPage = lazy(() => import("@/pages/marketing-replies"));
const MarketingHotAccountsPage = lazy(() => import("@/pages/marketing-hot-accounts"));
const ComplianceDashboardPage = lazy(() => import("@/pages/compliance-dashboard"));
const CampaignDetailPage = lazy(() => import("@/pages/campaign-detail"));
const CapitalDashboardPage    = lazy(() => import("@/pages/capital-dashboard"));
const CapitalPipelinePage     = lazy(() => import("@/pages/capital-pipeline"));
const CapitalInvestorsPage    = lazy(() => import("@/pages/capital-investors"));
const CapitalGrantsPage       = lazy(() => import("@/pages/capital-grants"));
const CapitalDocumentsPage    = lazy(() => import("@/pages/capital-documents"));
const CapitalContactsPage     = lazy(() => import("@/pages/capital-contacts"));
const CapitalRoundsPage       = lazy(() => import("@/pages/capital-rounds"));
const CapitalCommitmentsPage  = lazy(() => import("@/pages/capital-commitments"));
const CapitalUpdatesPage      = lazy(() => import("@/pages/capital-updates"));
const CapitalFollowUpsPage    = lazy(() => import("@/pages/capital-follow-ups"));
const CapitalEmailReviewPage  = lazy(() => import("@/pages/capital-email-review"));
const CapitalCommandCenterPage = lazy(() => import("@/pages/capital-command-center"));
const CapitalEngagementPage   = lazy(() => import("@/pages/capital-engagement"));
const CapitalReportsPage      = lazy(() => import("@/pages/capital-reports"));
const BookingPublicPage = lazy(() => import("@/pages/booking-public"));
const InvestorPortalPage = lazy(() => import("@/pages/investor-portal"));
const GlobalSearch = lazy(() => import("@/components/global-search").then(m => ({ default: m.GlobalSearch })));
const DemonAtmospherics = lazy(() => import("@/components/demon-atmospherics").then(m => ({ default: m.DemonAtmospherics })));

// ── Page-level loading fallback ───────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center flex-1 h-full min-h-[40vh]">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

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
  capital?: AccessLevel;
  mail_team: Record<string, { view: boolean; edit: boolean }>;
  calendar_team: number[];
};

export const FULL_PERMISSIONS: UserPermissions = {
  crm: "edit", partnerships: "edit", projects: "edit",
  communications: "edit", team_workload: "edit", knowledge: "edit",
  support: "edit", quoting: "edit", calendar: "edit",
  capital: "none",
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
  isCapitalUser?: boolean;
  permissions: UserPermissions;
  department?: string | null;
  jobTitle?: string | null;
  userType?: string;
  preferredLayout?: string;
  widgetVisibility?: Record<string, boolean>;
  defaultCommandCenter?: string | null;
  /** IANA timezone last detected from the user's browser, e.g. "America/Vancouver". */
  detectedTimezone?: string | null;
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
      <Suspense fallback={null}>
        <DemonAtmospherics />
      </Suspense>
      <div data-app-shell="root" className="flex h-screen w-full bg-background text-foreground overflow-hidden">
        <div className="hidden lg:flex">
          <AppSidebar userGlobalRole={user.globalRole || "sales"} userPermissions={user.permissions ?? FULL_PERMISSIONS} />
        </div>
        <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
          <Header user={user} onLogout={onLogout} />
          <main className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden relative scroll-smooth pb-20 lg:pb-0">
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === "k")) return;
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
        <Suspense fallback={null}>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </Suspense>
        <AppShell user={user} onLogout={onLogout}>
          <ChunkErrorBoundary key={appLocation}>
            <Suspense fallback={<PageLoader />}>{children}</Suspense>
          </ChunkErrorBoundary>
        </AppShell>
      </>
    );
  }

  function guard(section: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">, children: React.ReactNode) {
    return wrap(hasAccess(perms, role, section) ? children : <AccessDenied />);
  }

  function capitalGuard(children: React.ReactNode) {
    return wrap((perms.capital === "edit") ? children : <AccessDenied />);
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
      <Route path="/my-travel">{() => wrap(<MyTravelPage />)}</Route>
      <Route path="/work/team-calendar">{() => wrap(<TeamWorkCalendarPage />)}</Route>
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

      <Route path="/execution/forecast">{() => guard("crm", isAdvisor ? <AccessDenied /> : <PipelinePage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/revenue/deals">{() => guard("crm", isAdvisor ? <AccessDenied /> : <LeadsPage canEdit={isAdmin(role) || perms.crm === "edit"} lockedStatus="converted" pageTitle="Accounts Won" />)}</Route>
      <Route path="/intelligence/briefs">{() => wrap(<TodayPage />)}</Route>
      <Route path="/intelligence/signals">{() => wrap(<ActivityFeedPage />)}</Route>
      <Route path="/intelligence/rel-intelligence">{() => wrap(<RelationshipIntelligencePage />)}</Route>

      <Route path="/accounts/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <AccountProfilePage />)}</Route>
      <Route path="/accounts">{() => guard("crm", isAdvisor ? <AccessDenied /> : <AccountsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/contacts/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <ContactProfilePage />)}</Route>
      <Route path="/contacts">{() => guard("crm", isAdvisor ? <AccessDenied /> : <ContactsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/opportunities/:id">{(params) => guard("crm", isAdvisor ? <AccessDenied /> : <OpportunityProfilePage />)}</Route>
      <Route path="/opportunities">{() => guard("crm", isAdvisor ? <AccessDenied /> : <LeadsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/quotes">{() => guard("quoting", isAdvisor ? <AccessDenied /> : <QuotesPage canEdit={isAdmin(role) || perms.quoting === "edit"} />)}</Route>
      <Route path="/booking-outreach">{() => guard("crm", isAdvisor ? <AccessDenied /> : <BookingOutreachPage />)}</Route>
      <Route path="/booking-analytics">{() => guard("crm", isAdvisor ? <AccessDenied /> : <BookingAnalyticsPage />)}</Route>
      <Route path="/revenue-intelligence">{() => guard("crm", isAdvisor ? <AccessDenied /> : <RevenueIntelligencePage />)}</Route>

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

      <Route path="/strategy/partnerships/:typeSlug">{(params) => guard("partnerships", isAdvisor ? <AccessDenied /> : <PartnershipsPage typeSlug={(params as any)?.typeSlug || ""} canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/partnerships">{() => guard("partnerships", isAdvisor ? <AccessDenied /> : <PartnershipsPage typeSlug="" canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/industry">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/oem">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/government">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/research">{() => <Redirect to="/strategy/partnerships" />}</Route>

      <Route path="/gmail">{() => (
        <Suspense fallback={<PageLoader />}>
          <InboxFullScreenShell>
            <GmailInboxPage currentUserEmail={user.email} currentUserRole={user.globalRole || "sales"} userPermissions={perms} />
          </InboxFullScreenShell>
        </Suspense>
      )}</Route>
      <Route path="/relationships">{() => wrap(<RelationshipIntelligencePage />)}</Route>
      <Route path="/execution/calendar">{() => guard("calendar", <CalendarPage permissions={perms} currentUserId={user.id} isAdmin={isAdmin(role)} />)}</Route>
      <Route path="/execution/projects">{() => guard("projects", <ProjectsPage />)}</Route>
      <Route path="/operations/events">{() => wrap(<TradeshowEventsPage />)}</Route>
      <Route path="/execution/communications">{() => guard("communications", isAdvisor ? <AccessDenied /> : <CommunicationsPage />)}</Route>
      <Route path="/execution/team-workload">{() => guard("team_workload", <TeamWorkloadPage />)}</Route>
      <Route path="/current">{() => wrap(<CurrentsWorkspaceShell><CurrentPage /></CurrentsWorkspaceShell>)}</Route>
      <Route path="/execution/tasks">{() => wrap(<TasksHubPage />)}</Route>

      <Route path="/knowledge/assets">{() => guard("knowledge", <AssetsPage />)}</Route>
      <Route path="/price-lists">{() => guard("quoting", isAdvisor ? <AccessDenied /> : <PriceListsPage />)}</Route>

      <Route path="/support/tickets">{() => guard("support", <TicketsPage canEdit={isAdmin(role) || perms.support === "edit"} />)}</Route>

      <Route path="/board-pack">{() => wrap(<BoardPackPage />)}</Route>
      <Route path="/revenue">{() => advisorBlock(<RevenuePage />)}</Route>
      <Route path="/revenue-sim">{() => advisorBlock(<RevenueSimPage />)}</Route>
      <Route path="/revenue-ops">{() => advisorBlock(<RevenueOpsPage />)}</Route>
      <Route path="/winter">{() => wrap(<WinterHubPage />)}</Route>
      <Route path="/executive-copilot">{() => wrap(<ExecutiveCopilotPage />)}</Route>
      <Route path="/cortex/intel">{() => wrap(<CortexIntelLibraryPage />)}</Route>

      <Route path="/automations">{() => wrap(<AutomationsPage />)}</Route>
      <Route path="/automation/tasks">{() => <Redirect to="/automations?tab=task-rules" />}</Route>
      <Route path="/marketing/engagement">{() => guard("crm", <MarketingEngagementPage />)}</Route>
      <Route path="/settings/personal">{() => wrap(<PersonalSettingsPage />)}</Route>
      <Route path="/marketing/campaigns/:id">{() => guard("crm", <CampaignDetailPage />)}</Route>
      <Route path="/marketing/campaigns">{() => guard("crm", <MarketingCampaignsPage />)}</Route>
      <Route path="/marketing/audiences">{() => guard("crm", <MarketingAudiencesPage />)}</Route>
      <Route path="/marketing/templates">{() => guard("crm", <MarketingTemplatesPage />)}</Route>
      <Route path="/marketing/analytics">{() => guard("crm", <MarketingAnalyticsPage />)}</Route>
      <Route path="/marketing/suppression">{() => guard("crm", <MarketingSuppressionPage />)}</Route>
      <Route path="/marketing/replies">{() => guard("crm", <MarketingRepliesPage />)}</Route>
      <Route path="/marketing/compliance">{() => guard("crm", <ComplianceDashboardPage />)}</Route>
      <Route path="/marketing/dashboard">{() => guard("crm", <MarketingDashboardPage />)}</Route>
      <Route path="/marketing/hot-accounts">{() => guard("crm", <MarketingHotAccountsPage />)}</Route>
      <Route path="/marketing">{() => <Redirect to="/marketing/dashboard" />}</Route>

      <Route path="/capital/dashboard">{() => capitalGuard(<CapitalDashboardPage />)}</Route>
      <Route path="/capital/pipeline">{() => capitalGuard(<CapitalPipelinePage />)}</Route>
      <Route path="/capital/targets">{() => capitalGuard(<CapitalInvestorsPage />)}</Route>
      <Route path="/capital/contacts">{() => capitalGuard(<CapitalContactsPage />)}</Route>
      <Route path="/capital/rounds">{() => capitalGuard(<CapitalRoundsPage />)}</Route>
      <Route path="/capital/commitments">{() => capitalGuard(<CapitalCommitmentsPage />)}</Route>
      <Route path="/capital/grants">{() => capitalGuard(<CapitalGrantsPage />)}</Route>
      <Route path="/capital/updates">{() => capitalGuard(<CapitalUpdatesPage />)}</Route>
      <Route path="/capital/data-room">{() => capitalGuard(<CapitalDocumentsPage />)}</Route>
      <Route path="/capital/follow-ups">{() => capitalGuard(<CapitalFollowUpsPage />)}</Route>
      <Route path="/capital/email-review">{() => capitalGuard(<CapitalEmailReviewPage />)}</Route>
      <Route path="/capital/command-center">{() => capitalGuard(<CapitalCommandCenterPage />)}</Route>
      <Route path="/capital/engagement">{() => capitalGuard(<CapitalEngagementPage />)}</Route>
      <Route path="/capital/reports">{() => capitalGuard(<CapitalReportsPage />)}</Route>
      <Route path="/capital/investors">{() => <Redirect to="/capital/targets" />}</Route>
      <Route path="/capital/documents">{() => <Redirect to="/capital/data-room" />}</Route>
      <Route path="/capital">{() => <Redirect to="/capital/dashboard" />}</Route>
      <Route path="/execution/daily">{() => wrap(<DailyExecutionPage />)}</Route>

      <Route path="/admin/users">{() => wrap(<AdminUsersPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/admin/task-hub-access">{() => wrap(<AdminTaskAccessPage />)}</Route>
      <Route path="/admin/integrations">{() => wrap(<AdminIntegrationsPage />)}</Route>
      <Route path="/admin/signatures">{() => wrap(<AdminSignaturesPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/admin/roles">{() => wrap(<AdminRolesPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/jira">{() => wrap(<JiraPage />)}</Route>
      <Route path="/confluence">{() => wrap(<ConfluencePage />)}</Route>
      <Route path="/training">{() => wrap(<TrainingHubPage />)}</Route>
      <Route path="/help">{() => wrap(<HelpCenterPage />)}</Route>
      <Route path="/settings">{() => wrap(<SettingsPage />)}</Route>
      <Route path="/settings/mailbox">{() => wrap(<MailboxSettingsPage />)}</Route>
      <Route path="/settings/mailbox-health">{() => wrap(<MailboxHealthPage />)}</Route>
      <Route path="/settings/signatures">{() => wrap(<SignatureSettingsPage />)}</Route>
      <Route path="/settings/voice-profiles">{() => wrap(<AiVoiceProfilesPage />)}</Route>
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

      <Route>{() => wrap(<Suspense fallback={<PageLoader />}><NotFound /></Suspense>)}</Route>
    </Switch>
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tzCtx, setTzCtx] = useState<TimezoneContextValue>({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: null,
    detectedAt: null,
  });

  useEffect(() => {
    if (typeof performance !== "undefined") performance.mark("vs-bootstrap-start");
    fetch("/api/session/bootstrap", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (typeof performance !== "undefined") performance.mark("vs-bootstrap-end");
        if (data?.authenticated) setUser(data as AuthUser);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        if (typeof performance !== "undefined") {
          try {
            performance.measure("vs-bootstrap", "vs-bootstrap-start", "vs-bootstrap-end");
            const [m] = performance.getEntriesByName("vs-bootstrap");
            if (m) console.debug(`[vs:perf] bootstrap: ${m.duration.toFixed(0)}ms`);
          } catch {}
        }
      });
  }, []);

  // ── Dev-mode first-load performance summary ───────────────────────────────
  // Fires once after the shell transitions from loading → rendered.
  // Logs a table of key milestones so the team can spot regressions quickly.
  const _shellSummaryFired = useRef(false);
  useEffect(() => {
    if (loading || _shellSummaryFired.current) return;
    _shellSummaryFired.current = true;
    if (typeof performance === "undefined") return;
    try {
      performance.mark("vs-shell-rendered");
      const jsEntry   = performance.getEntriesByName("vs-js-loaded")[0];
      const bsEntry   = performance.getEntriesByName("vs-bootstrap")[0];
      const shellEntry = performance.getEntriesByName("vs-shell-rendered")[0];
      const jsLoadedMs   = jsEntry?.startTime   ?? 0;
      const bootstrapMs  = bsEntry?.duration    ?? 0;
      const shellMs      = shellEntry?.startTime ?? 0;
      const totalMs      = shellMs - jsLoadedMs;
      if (import.meta.env.DEV) {
        console.log(
          "%cVoltSafe Growth OS — First Load Performance\n" +
          `  JS bundle loaded:   ${jsLoadedMs.toFixed(0)} ms after nav start\n` +
          `  Bootstrap (api):    ${bootstrapMs.toFixed(0)} ms\n` +
          `  Shell rendered:     ${shellMs.toFixed(0)} ms after nav start\n` +
          `  Time JS→shell:      ${totalMs.toFixed(0)} ms\n` +
          `  APIs before shell:  1 (/api/session/bootstrap)`,
          "font-weight:bold;color:#00BFA5;"
        );
      }
    } catch {}
  }, [loading]);

  // Send detected timezone to backend once after every login (keyed on user.id).
  // Fire-and-forget — never blocks login or UI rendering.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const send = async () => {
      try {
        const payload = detectBrowserTimezone();
        // Immediately update local context with detected values (optimistic)
        if (!cancelled) {
          setTzCtx({
            timezone: payload.timezone,
            offsetMinutes: payload.timezoneOffsetMinutes,
            detectedAt: payload.localTimestamp,
          });
        }
        const res = await fetch("/api/session/timezone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setTzCtx({
            timezone: data.timezone,
            offsetMinutes: data.offsetMinutes ?? null,
            detectedAt: data.detectedAt ?? null,
          });
          setUser(u => u ? { ...u, detectedTimezone: data.timezone } : u);
        }
      } catch {
        // Non-fatal — app continues with browser-detected timezone
      }
    };
    send();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    queryClient.clear();
  };

  const resetToken = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TimezoneContext.Provider value={tzCtx}>
      <ThemeProvider>
        <TooltipProvider>
          <ChunkErrorBoundary>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen bg-background">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          }>
            {window.location.pathname === "/book" ? (
              <BookingPublicPage />
            ) : window.location.pathname === "/unsubscribe" && window.location.search.includes("token=") ? (
              <Suspense fallback={<PageLoader />}><ComplianceUnsubscribePage /></Suspense>
            ) : window.location.pathname.startsWith("/unsubscribe/") ? (
              <UnsubscribePage />
            ) : window.location.pathname.startsWith("/preferences") ? (
              <Suspense fallback={<PageLoader />}><PreferencesPage /></Suspense>
            ) : window.location.pathname.startsWith("/reset-password") || resetToken ? (
              <ResetPasswordPage token={resetToken ?? ""} onLogin={setUser} />
            ) : window.location.pathname.startsWith("/investor-portal/") ? (
              <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-[#0a1628]"><div className="h-8 w-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" /></div>}><InvestorPortalPage /></Suspense>
            ) : !user ? (
              user === null && !loading ? (
                <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-background"><div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>}>
                  <LoginPage onLogin={setUser} />
                </Suspense>
              ) : null
            ) : user.mustChangePassword ? (
              <Suspense fallback={null}>
                <ChangePasswordPage onChanged={() => setUser(u => u ? { ...u, mustChangePassword: false } : u)} />
              </Suspense>
            ) : (
              <>
                <AuthenticatedRouter user={user} onLogout={handleLogout} />
                <Suspense fallback={null}>
                  <VoiceAssistant currentUserId={user.id} currentUserRole={user.globalRole || "sales"} userPermissions={user.permissions ?? FULL_PERMISSIONS} />
                  <QuickCapture />
                </Suspense>
                <UpcomingMeetingBanner currentUserId={user.id} isAdmin={isAdmin(user.globalRole || "sales")} />
                <DemoModeBanner />
                <DemoCalloutOverlay />
                <Toaster />
              </>
            )}
          </Suspense>
          </ChunkErrorBoundary>
        </TooltipProvider>
      </ThemeProvider>
      </TimezoneContext.Provider>
    </QueryClientProvider>
  );
}

export default App;
