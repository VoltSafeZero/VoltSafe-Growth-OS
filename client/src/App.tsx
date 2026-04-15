import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/dashboard/header";
import { MobileNav } from "@/components/dashboard/mobile-nav";

import Dashboard from "@/pages/dashboard";
import CommandCenter from "@/pages/command-center";
import DailyCommandCenter from "@/pages/daily-command-center";
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
import ActivityFeedPage from "@/pages/activity-feed";
import NotesPage from "@/pages/notes-page";
import TasksHubPage from "@/pages/tasks-hub";
import TaskRulesSettingsPage from "@/pages/task-rules-settings";

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
      <div className="flex min-h-screen w-full bg-background text-foreground overflow-hidden">
        <div className="hidden md:flex">
          <AppSidebar userGlobalRole={user.globalRole || "sales"} userPermissions={user.permissions ?? FULL_PERMISSIONS} />
        </div>
        <div className="flex flex-col flex-1 w-full overflow-hidden">
          <Header user={user} onLogout={onLogout} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>
      <MobileNav />
    </SidebarProvider>
  );
}

function AuthenticatedRouter({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const perms = user.permissions ?? FULL_PERMISSIONS;
  const role = user.globalRole || "sales";

  function wrap(children: React.ReactNode) {
    return <AppShell user={user} onLogout={onLogout}>{children}</AppShell>;
  }

  function guard(section: keyof Pick<UserPermissions, "crm" | "partnerships" | "projects" | "communications" | "team_workload" | "knowledge" | "support" | "quoting" | "calendar">, children: React.ReactNode) {
    return wrap(hasAccess(perms, role, section) ? children : <AccessDenied />);
  }

  return (
    <Switch>
      <Route path="/">{() => wrap(<DailyCommandCenter />)}</Route>
      <Route path="/command-center">{() => wrap(<CommandCenter />)}</Route>
      <Route path="/dashboard">{() => wrap(<Dashboard />)}</Route>
      <Route path="/today">{() => wrap(<TodayPage />)}</Route>
      <Route path="/pipeline">{() => guard("crm", <PipelinePage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>

      {/* ── Growth OS: Relationships ───────────────────────────────── */}
      <Route path="/accounts/:id">{(params) => guard("crm", <AccountProfilePage />)}</Route>
      <Route path="/accounts">{() => guard("crm", <AccountsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/contacts/:id">{(params) => guard("crm", <ContactProfilePage />)}</Route>
      <Route path="/contacts">{() => guard("crm", <ContactsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/opportunities/:id">{(params) => guard("crm", <OpportunityProfilePage />)}</Route>
      <Route path="/opportunities">{() => guard("crm", <LeadsPage canEdit={isAdmin(role) || perms.crm === "edit"} />)}</Route>
      <Route path="/quotes">{() => guard("quoting", <QuotesPage canEdit={isAdmin(role) || perms.quoting === "edit"} />)}</Route>

      {/* ── Growth OS: Coming Soon stubs ──────────────────────────── */}
      <Route path="/activity">{() => wrap(<ActivityFeedPage />)}</Route>
      <Route path="/notes">{() => wrap(<NotesPage />)}</Route>
      {(["renewals", "segments", "tags", "automations", "imports"] as const).map(slug => (
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
      <Route path="/strategy/partnerships/:typeSlug">{(params) => guard("partnerships", <PartnershipsPage typeSlug={(params as any)?.typeSlug || ""} canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/partnerships">{() => guard("partnerships", <PartnershipsPage typeSlug="" canEdit={isAdmin(role) || perms.partnerships === "edit"} />)}</Route>
      <Route path="/strategy/industry">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/oem">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/government">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/research">{() => <Redirect to="/strategy/partnerships" />}</Route>

      {/* ── EXECUTION ─────────────────────────────────────────────── */}
      <Route path="/gmail">{() => wrap(<GmailInboxPage currentUserEmail={user.email} currentUserRole={user.globalRole || "sales"} userPermissions={perms} />)}</Route>
      <Route path="/relationships">{() => wrap(<RelationshipIntelligencePage />)}</Route>
      <Route path="/execution/calendar">{() => guard("calendar", <CalendarPage permissions={perms} currentUserId={user.id} isAdmin={isAdmin(role)} />)}</Route>
      <Route path="/execution/projects">{() => guard("projects", <ProjectsPage />)}</Route>
      <Route path="/execution/communications">{() => guard("communications", <CommunicationsPage />)}</Route>
      <Route path="/execution/team-workload">{() => guard("team_workload", <TeamWorkloadPage />)}</Route>
      <Route path="/execution/tasks">{() => wrap(<TasksHubPage />)}</Route>

      {/* ── KNOWLEDGE ─────────────────────────────────────────────── */}
      <Route path="/knowledge/assets">{() => guard("knowledge", <AssetsPage />)}</Route>
      <Route path="/price-lists">{() => guard("quoting", <PriceListsPage />)}</Route>

      {/* ── SUPPORT ───────────────────────────────────────────────── */}
      <Route path="/support/tickets">{() => guard("support", <TicketsPage canEdit={isAdmin(role) || perms.support === "edit"} />)}</Route>

      {/* ── AUTOMATION ────────────────────────────────────────────── */}
      <Route path="/automation/tasks">{() => wrap(<TaskRulesSettingsPage />)}</Route>

      {/* ── ADMIN ─────────────────────────────────────────────────── */}
      <Route path="/admin/users">{() => wrap(<AdminUsersPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/admin/integrations">{() => wrap(<AdminIntegrationsPage />)}</Route>
      <Route path="/jira">{() => wrap(<JiraPage />)}</Route>
      <Route path="/confluence">{() => wrap(<ConfluencePage />)}</Route>
      <Route path="/settings">{() => wrap(<SettingsPage />)}</Route>

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
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
