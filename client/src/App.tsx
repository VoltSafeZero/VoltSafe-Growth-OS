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
      <Route path="/">
        <AppShell>
          <Dashboard />
        </AppShell>
      </Route>
      {/* Route fallbacks for sidebar links so they don't 404 immediately */}
      <Route path="/analytics">
        <AppShell>
          <div className="p-8"><h1 className="text-2xl font-bold">Analytics</h1></div>
        </AppShell>
      </Route>
      <Route path="/customers">
        <AppShell>
          <div className="p-8"><h1 className="text-2xl font-bold">Customers</h1></div>
        </AppShell>
      </Route>
      <Route path="/transactions">
        <AppShell>
          <div className="p-8"><h1 className="text-2xl font-bold">Transactions</h1></div>
        </AppShell>
      </Route>
      
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
