import { Link } from "wouter";
import { Settings, PenSquare, Mic, BellRing, ArrowRight, HelpCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export default function PersonalSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: currentUser } = useQuery<{ showHelpIcons?: boolean }>({
    queryKey: ["/api/auth/me"],
  });

  const showHelpIcons = currentUser?.showHelpIcons ?? true;

  const toggleHelpIcons = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await apiRequest("PATCH", "/api/users/me/layout", { showHelpIcons: next });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: () => {
      toast({ title: "Could not update help icon preference", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="personal-settings-hub">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          Personal Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your email signatures, AI voice profile, and notification preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Email Signatures */}
        <Link href="/settings/signatures">
          <div
            className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3"
            data-testid="personal-settings-card-signatures"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-primary/10">
                <PenSquare className="w-5 h-5 text-primary" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Email Signatures
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Create and manage your email signatures with CTAs and inline images.
              </p>
            </div>
          </div>
        </Link>

        {/* AI Voice Profiles */}
        <Link href="/settings/voice-profiles">
          <div
            className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3"
            data-testid="personal-settings-card-voice-profiles"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Mic className="w-5 h-5 text-violet-400" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                AI Voice Profiles
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Train Cortex to write emails in your voice using your sent mail.
              </p>
            </div>
          </div>
        </Link>

        {/* Digest Settings */}
        <Link href="/alerts-digest">
          <div
            className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3"
            data-testid="personal-settings-card-digest"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <BellRing className="w-5 h-5 text-amber-400" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Digest Settings
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Configure your daily email digest, alert frequencies, and notification channels.
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Help icons toggle */}
      <div className="rounded-xl border border-border/50 bg-card p-5 flex items-center justify-between gap-4" data-testid="personal-settings-help-icons">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <HelpCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Show Help Icons</h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug max-w-md">
              Show the small info icons next to tabs, sections, and fields throughout the app with tips and context.
            </p>
          </div>
        </div>
        <Switch
          data-testid="switch-show-help-icons"
          checked={showHelpIcons}
          onCheckedChange={(checked) => toggleHelpIcons.mutate(checked)}
          disabled={toggleHelpIcons.isPending}
        />
      </div>

      {/* Quick links section */}
      <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
        <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">All personal settings</p>
        <div className="flex flex-col gap-1">
          {[
            { label: "Email Signatures",  href: "/settings/signatures",     icon: PenSquare },
            { label: "AI Voice Profiles", href: "/settings/voice-profiles",  icon: Mic },
            { label: "Digest & Alerts",   href: "/alerts-digest",            icon: BellRing },
            { label: "Account Settings",  href: "/settings",                 icon: Settings },
          ].map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href}>
              <div
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-primary/8 hover:text-primary text-muted-foreground text-sm transition-colors cursor-pointer group"
                data-testid={`personal-settings-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{label}</span>
                <ArrowRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
