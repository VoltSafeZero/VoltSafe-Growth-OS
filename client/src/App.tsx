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
import GmailInboxPage from "@/pages/gmail-inbox";
import AssetsPage from "@/pages/assets";
import PriceListsPage from "@/pages/price-lists";
import JiraPage from "@/pages/jira";
import ConfluencePage from "@/pages/confluence";
import AdminIntegrationsPage from "@/pages/admin-integrations";
import AdminUsersPage from "@/pages/admin-users";
import ProjectsPage from "@/pages/projects";

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  globalRole: string;
  status: string;
  mustChangePassword: boolean;
};

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}

function AppShell({ children, user, onLogout }: { children: React.ReactNode; user: AuthUser; onLogout: () => void }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex min-h-screen w-full bg-background text-foreground overflow-hidden">
        <div className="hidden md:flex"><AppSidebar userGlobalRole={user.globalRole || "sales"} /></div>
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
  const wrap = (children: React.ReactNode) => (
    <AppShell user={user} onLogout={onLogout}>{children}</AppShell>
  );

  return (
    <Switch>
      {/* ── HOME ──────────────────────────────────────────────────── */}
      <Route path="/">{() => wrap(<Dashboard />)}</Route>

      {/* ── CRM ───────────────────────────────────────────────────── */}
      <Route path="/accounts">{() => wrap(<AccountsPage />)}</Route>
      <Route path="/contacts">{() => wrap(<ContactsPage />)}</Route>
      <Route path="/opportunities">{() => wrap(<LeadsPage />)}</Route>
      <Route path="/quotes">{() => wrap(<QuotesPage />)}</Route>

      {/* ── STRATEGY ──────────────────────────────────────────────── */}
      <Route path="/strategy/partnerships/:typeSlug">{(params) => wrap(<PartnershipsPage typeSlug={(params as any)?.typeSlug || ""} />)}</Route>
      <Route path="/strategy/partnerships">{() => wrap(<PartnershipsPage typeSlug="" />)}</Route>
      <Route path="/strategy/industry">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/oem">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/government">{() => <Redirect to="/strategy/partnerships" />}</Route>
      <Route path="/strategy/research">{() => <Redirect to="/strategy/partnerships" />}</Route>

      {/* ── EXECUTION ─────────────────────────────────────────────── */}
      <Route path="/gmail">{() => wrap(<GmailInboxPage currentUserEmail={user.email} />)}</Route>
      <Route path="/execution/calendar">{() => wrap(<CalendarPage />)}</Route>
      <Route path="/execution/projects">{() => wrap(<ProjectsPage />)}</Route>
      <Route path="/execution/communications">{() => wrap(<CommunicationsPage />)}</Route>
      <Route path="/execution/team-workload">{() => wrap(<TeamWorkloadPage />)}</Route>

      {/* ── KNOWLEDGE ─────────────────────────────────────────────── */}
      <Route path="/knowledge/assets">{() => wrap(<AssetsPage />)}</Route>
      <Route path="/price-lists">{() => wrap(<PriceListsPage />)}</Route>

      {/* ── SUPPORT ───────────────────────────────────────────────── */}
      <Route path="/support/tickets">{() => wrap(<TicketsPage />)}</Route>

      {/* ── ADMIN ─────────────────────────────────────────────────── */}
      <Route path="/admin/users">{() => wrap(<AdminUsersPage currentUserGlobalRole={user.globalRole || "sales"} />)}</Route>
      <Route path="/admin/integrations">{() => wrap(<AdminIntegrationsPage />)}</Route>
      <Route path="/jira">{() => wrap(<JiraPage />)}</Route>
      <Route path="/confluence">{() => wrap(<ConfluencePage />)}</Route>
      <Route path="/settings">{() => wrap(<SettingsPage />)}</Route>

      {/* ── LEGACY REDIRECTS (migration-safe, never 404) ──────────── */}
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

      {/* ── MISC ──────────────────────────────────────────────────── */}
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
      .then((data) => {
        if (data) setUser(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    queryClient.clear();
  };

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
        <LoginPage onLogin={setUser} />
      </ThemeProvider>
    );
  }

  if (user.mustChangePassword) {
    return (
      <ThemeProvider defaultTheme="dark">
        <ChangePasswordPage
          onComplete={() => setUser({ ...user, mustChangePassword: false })}
        />
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
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
