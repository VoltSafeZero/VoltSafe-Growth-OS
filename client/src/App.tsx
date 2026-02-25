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
import OpportunitiesPage from "@/pages/opportunities";
import QuotesPage from "@/pages/quotes";
import TicketsPage from "@/pages/tickets";
import CommunicationsPage from "@/pages/communications";
import NotFound from "@/pages/not-found";

function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex min-h-screen w-full bg-background text-foreground overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 w-full overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <AppShell><Dashboard /></AppShell>}</Route>
      <Route path="/marinas">{() => <AppShell><MarinasPage /></AppShell>}</Route>
      <Route path="/leads">{() => <AppShell><LeadsPage /></AppShell>}</Route>
      <Route path="/accounts">{() => <AppShell><AccountsPage /></AppShell>}</Route>
      <Route path="/opportunities">{() => <AppShell><OpportunitiesPage /></AppShell>}</Route>
      <Route path="/quotes">{() => <AppShell><QuotesPage /></AppShell>}</Route>
      <Route path="/tickets">{() => <AppShell><TicketsPage /></AppShell>}</Route>
      <Route path="/communications">{() => <AppShell><CommunicationsPage /></AppShell>}</Route>
      <Route path="/settings">{() => <AppShell><div className="p-8"><h1 className="text-2xl font-bold">Settings</h1><p className="text-muted-foreground mt-2">Admin settings coming soon.</p></div></AppShell>}</Route>
      <Route path="/integrations">{() => <AppShell><div className="p-8"><h1 className="text-2xl font-bold">Integrations</h1><p className="text-muted-foreground mt-2">Gmail, HubSpot, and Klaviyo integrations coming soon.</p></div></AppShell>}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
