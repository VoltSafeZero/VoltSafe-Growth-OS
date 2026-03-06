import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/dashboard/header";

import Dashboard from "@/pages/dashboard";
import MarinasPage from "@/pages/marinas";
import LeadsPage from "@/pages/leads";
import AccountsPage from "@/pages/accounts";
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

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

function AppShell({ children, user, onLogout }: { children: React.ReactNode; user: AuthUser; onLogout: () => void }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex min-h-screen w-full bg-background text-foreground overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 w-full overflow-hidden">
          <Header user={user} onLogout={onLogout} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AuthenticatedRouter({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <Switch>
      <Route path="/">{() => <AppShell user={user} onLogout={onLogout}><Dashboard /></AppShell>}</Route>
      <Route path="/marinas">{() => <AppShell user={user} onLogout={onLogout}><MarinasPage /></AppShell>}</Route>
      <Route path="/leads">{() => <AppShell user={user} onLogout={onLogout}><LeadsPage /></AppShell>}</Route>
      <Route path="/accounts">{() => <AppShell user={user} onLogout={onLogout}><AccountsPage /></AppShell>}</Route>
      <Route path="/quotes">{() => <AppShell user={user} onLogout={onLogout}><QuotesPage /></AppShell>}</Route>
      <Route path="/tickets">{() => <AppShell user={user} onLogout={onLogout}><TicketsPage /></AppShell>}</Route>
      <Route path="/communications">{() => <AppShell user={user} onLogout={onLogout}><CommunicationsPage /></AppShell>}</Route>
      <Route path="/calendar">{() => <AppShell user={user} onLogout={onLogout}><CalendarPage /></AppShell>}</Route>
      <Route path="/team-workload">{() => <AppShell user={user} onLogout={onLogout}><TeamWorkloadPage /></AppShell>}</Route>
      <Route path="/partnerships/strategic-industry">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="strategic_industry" /></AppShell>}</Route>
      <Route path="/partnerships/technology">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="technology" /></AppShell>}</Route>
      <Route path="/partnerships/distribution">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="distribution" /></AppShell>}</Route>
      <Route path="/partnerships/oem">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="oem" /></AppShell>}</Route>
      <Route path="/partnerships/government">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="government" /></AppShell>}</Route>
      <Route path="/partnerships/research">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="research" /></AppShell>}</Route>
      <Route path="/partnerships/pilot">{() => <AppShell user={user} onLogout={onLogout}><PartnershipsPage category="pilot" /></AppShell>}</Route>
      <Route path="/ecosystem/organizations">{() => <AppShell user={user} onLogout={onLogout}><EcosystemOrganizationsPage /></AppShell>}</Route>
      <Route path="/ecosystem/people">{() => <AppShell user={user} onLogout={onLogout}><EcosystemPeoplePage /></AppShell>}</Route>
      <Route path="/ecosystem/relationships">{() => <AppShell user={user} onLogout={onLogout}><EcosystemRelationshipsPage /></AppShell>}</Route>
      <Route path="/ecosystem/events">{() => <AppShell user={user} onLogout={onLogout}><EcosystemEventsPage /></AppShell>}</Route>
      <Route path="/ecosystem/regions">{() => <AppShell user={user} onLogout={onLogout}><EcosystemRegionsPage /></AppShell>}</Route>
      <Route path="/settings">{() => <AppShell user={user} onLogout={onLogout}><SettingsPage /></AppShell>}</Route>
      <Route path="/integrations">{() => <AppShell user={user} onLogout={onLogout}><div className="p-8"><h1 className="text-2xl font-bold">Integrations</h1><p className="text-muted-foreground mt-2">Gmail, HubSpot, and Klaviyo integrations coming soon.</p></div></AppShell>}</Route>
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
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
