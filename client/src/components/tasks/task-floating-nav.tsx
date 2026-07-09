import { useLocation } from "wouter";
import { Inbox, CalendarClock, LayoutGrid, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type NavItem = {
  key: "inbox" | "planner" | "board" | "switch-boards";
  label: string;
  icon: typeof Inbox;
};

const NAV_ITEMS: NavItem[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "planner", label: "Planner", icon: CalendarClock },
  { key: "board", label: "Board", icon: LayoutGrid },
  { key: "switch-boards", label: "Switch boards", icon: Layers },
];

export function TaskFloatingNav() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleClick = (key: NavItem["key"]) => {
    switch (key) {
      case "board":
        // Already on the Tasks Hub board — no-op, this is the active item.
        break;
      case "inbox":
        navigate("/gmail");
        break;
      case "planner":
      case "switch-boards":
        toast({ title: "Coming soon", description: "This feature isn't available yet." });
        break;
    }
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-full border border-border/50 bg-background/95 backdrop-blur-md shadow-lg px-1.5 py-1.5"
      data-testid="floating-task-nav"
    >
      {NAV_ITEMS.map(item => {
        const isActive = item.key === "board";
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => handleClick(item.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
            aria-current={isActive ? "page" : undefined}
            data-testid={`floating-nav-${item.key}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
