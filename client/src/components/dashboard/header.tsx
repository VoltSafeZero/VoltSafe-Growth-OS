import { useState, useRef, useEffect } from "react";
import { Search, Bell, LogOut, X, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSidebar } from "@/components/ui/sidebar";
import navLogo from "@assets/nav-logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

export function Header({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "VS";
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus();
    }
  }, [mobileSearchOpen]);

  const { toggleSidebar } = useSidebar();

  return (
    <header className="h-auto py-2 flex items-center justify-between px-3 sm:px-6 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
      {mobileSearchOpen ? (
        <div className="flex items-center gap-2 flex-1 md:hidden">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={mobileSearchRef}
              placeholder="Search..."
              className="pl-9 bg-secondary/30 border-transparent focus-visible:border-primary/50 focus-visible:ring-primary/20 rounded-full"
              data-testid="input-mobile-search"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => setMobileSearchOpen(false)}
            data-testid="button-close-mobile-search"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 sm:gap-4 flex-1">
            <button
              onClick={toggleSidebar}
              className="md:hidden flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border/50 text-sm font-medium text-foreground active:scale-95 transition-all"
              data-testid="button-mobile-sidebar"
            >
              <Menu className="w-5 h-5 text-primary" />
              <span>Menu</span>
            </button>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden rounded-full text-muted-foreground"
              onClick={() => setMobileSearchOpen(true)}
              data-testid="button-open-mobile-search"
            >
              <Search className="w-5 h-5" />
            </Button>

            <div className="relative w-full max-w-md hidden md:flex items-center">
              <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-9 bg-secondary/30 border-transparent focus-visible:border-primary/50 focus-visible:ring-primary/20 rounded-full h-10 transition-all"
                data-testid="input-global-search"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => window.dispatchEvent(new Event("open-cortex-ai"))}
              className="relative flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
              data-testid="button-header-cortex-ai"
            >
              <img src={navLogo} alt="VoltSafe Cortex" className="w-[6.75rem] h-[6.75rem] object-contain mix-blend-screen brightness-125" />
            </button>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground rounded-full" data-testid="button-notifications">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-background"></span>
            </Button>
            <div className="h-6 w-px bg-border/50 mx-1 hidden sm:block"></div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 p-1 rounded-full sm:pr-3 transition-colors hover:bg-secondary/50" data-testid="button-user-menu">
                  <Avatar className="w-8 h-8 border border-primary/30 bg-primary/10">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium hidden sm:inline">{user?.name || "User"}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{user?.name}</span>
                    <span className="text-xs text-muted-foreground font-normal">{user?.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onLogout}
                  className="text-red-400 focus:text-red-400 cursor-pointer"
                  data-testid="button-logout"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </header>
  );
}
