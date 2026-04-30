import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import navLogo from "@assets/nav-logo.png";

interface InboxFullScreenShellProps {
  children: React.ReactNode;
}

export function InboxFullScreenShell({ children }: InboxFullScreenShellProps) {
  const [, setLocation] = useLocation();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <div
      data-app-shell="inbox-fullscreen"
      className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-0.5 border-b border-border/50 bg-background/95 backdrop-blur-sm flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="button-inbox-back"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Back</span>
        </Button>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-cortex-ai"))}
          className="relative flex items-center justify-center min-h-10 min-w-10 p-1 rounded-md cursor-pointer transition-opacity hover:opacity-80 active:scale-[0.98]"
          aria-label="Open Cortex AI"
          data-testid="button-inbox-cortex-ai"
        >
          <img
            src={navLogo}
            alt="VoltSafe Growth OS"
            className="w-8 h-8 sm:w-9 sm:h-9 object-contain mix-blend-screen brightness-125"
          />
        </button>
      </div>

      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
