import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Fingerprint, Trash2, Shield, Smartphone, Loader2,
  CalendarDays, RefreshCw, Link2, Link2Off, CheckCircle2,
  AlertCircle, Clock, Settings2, Apple, ChevronLeft, FlaskConical,
  CalendarCheck, ShieldAlert, Users, WifiOff, Wifi,
} from "lucide-react";
import { SiGooglecalendar } from "react-icons/si";
import { startRegistration } from "@simplewebauthn/browser";
import { formatDistanceToNow } from "date-fns";

type Credential = {
  id: number;
  deviceName: string | null;
  createdAt: string;
};

type CalendarConnection = {
  id: number;
  provider: string;
  accountEmail: string | null;
  displayName: string | null;
  isActive: boolean;
  defaultCalendarId: string | null;
  defaultCalendarName: string | null;
  syncEnabled: boolean;
  syncDirection: string | null;
  syncFrequencyMinutes: number | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  conflictResolution: string | null;
  calendarsDiscovered: { name: string; url: string; color?: string }[] | null;
};

// ─── CalDAV Connect Dialog ────────────────────────────────────────────────────

type DiscoveredCalendar = { name: string; url: string; color?: string };

function CalDavConnectDialog({
  open,
  onClose,
  provider,
}: {
  open: boolean;
  onClose: () => void;
  provider: "apple" | "caldav";
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"credentials" | "confirm">("credentials");
  const [url, setUrl] = useState(provider === "apple" ? "https://caldav.icloud.com" : "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredCalendar[]>([]);
  const [conflictResolution, setConflictResolution] = useState("latest_wins");

  const testMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/calendar/integrations/caldav/test", { url, username, password }),
    onSuccess: (data: any) => {
      setDiscovered(data.calendars || []);
      setStep("confirm");
    },
    onError: (err: any) => {
      toast({
        title: "Connection failed",
        description: err.message || "Could not reach the calendar server. Check your credentials.",
        variant: "destructive",
      });
    },
  });

  const connectMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/calendar/integrations/caldav/connect", {
        url,
        username,
        password,
        provider,
        conflictResolution,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/integrations"] });
      toast({ title: "Connected", description: "Calendar connected successfully." });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err.message || "Could not save the connection.",
        variant: "destructive",
      });
    },
  });

  const handleTest = () => {
    if (!url || !username || !password) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    testMutation.mutate();
  };

  const handleClose = () => {
    setStep("credentials");
    setDiscovered([]);
    onClose();
  };

  const isApple = provider === "apple";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isApple ? (
              <><Apple className="h-5 w-5" /> Connect Apple iCloud Calendar</>
            ) : (
              <><CalendarDays className="h-5 w-5" /> Connect CalDAV Calendar</>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === "credentials"
              ? isApple
                ? "Connect your iCloud calendar using an app-specific password."
                : "Connect a CalDAV-compatible calendar server."
              : "Connection successful — review your calendars before saving."}
          </DialogDescription>
        </DialogHeader>

        {step === "credentials" ? (
          <div className="space-y-4">
            {isApple && (
              <div className="text-xs text-muted-foreground bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 space-y-1">
                <p className="font-medium text-blue-400">Apple App-Specific Password Required</p>
                <p>
                  Apple requires an app-specific password for third-party calendar access.{" "}
                  <a
                    href="https://appleid.apple.com/account/manage"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-blue-400 hover:text-blue-300"
                  >
                    Generate one at appleid.apple.com
                  </a>{" "}
                  under Security → App-Specific Passwords.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="caldav-url" data-testid="label-caldav-url">
                {isApple ? "Server URL" : "CalDAV Server URL"}
              </Label>
              <Input
                id="caldav-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://caldav.icloud.com"
                data-testid="input-caldav-url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="caldav-username" data-testid="label-caldav-username">
                {isApple ? "Apple ID (email)" : "Username"}
              </Label>
              <Input
                id="caldav-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={isApple ? "you@icloud.com" : "username"}
                data-testid="input-caldav-username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="caldav-password" data-testid="label-caldav-password">
                {isApple ? "App-Specific Password" : "Password"}
              </Label>
              <Input
                id="caldav-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isApple ? "xxxx-xxxx-xxxx-xxxx" : "password"}
                data-testid="input-caldav-password"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Success banner */}
            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Connected to <span className="font-medium">{url}</span></span>
            </div>

            {/* Discovered calendars */}
            {discovered.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Discovered Calendars ({discovered.length})
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-border/50 divide-y divide-border/30">
                  {discovered.map((cal, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      {cal.color ? (
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cal.color }} />
                      ) : (
                        <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm truncate">{cal.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conflict resolution */}
            <div className="space-y-2">
              <Label data-testid="label-conflict-resolution">Conflict Resolution</Label>
              <Select value={conflictResolution} onValueChange={setConflictResolution}>
                <SelectTrigger data-testid="select-conflict-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_wins">Latest update wins</SelectItem>
                  <SelectItem value="provider_wins">Provider always wins</SelectItem>
                  <SelectItem value="cortex_wins">Cortex always wins</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Determines which version to keep when the same event is edited in both places.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          {step === "credentials" ? (
            <>
              <Button variant="outline" onClick={handleClose} data-testid="button-caldav-cancel">
                Cancel
              </Button>
              <Button
                onClick={handleTest}
                disabled={testMutation.isPending}
                data-testid="button-caldav-test"
              >
                {testMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing…</>
                ) : (
                  <><FlaskConical className="mr-2 h-4 w-4" /> Test Connection</>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("credentials")}
                data-testid="button-caldav-back"
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                data-testid="button-caldav-connect"
              >
                {connectMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  <><Link2 className="mr-2 h-4 w-4" /> Save & Connect</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sync Settings Dialog ─────────────────────────────────────────────────────

function SyncSettingsDialog({
  connection,
  onClose,
}: {
  connection: CalendarConnection;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [direction, setDirection] = useState(connection.syncDirection || "pull");
  const [frequency, setFrequency] = useState(String(connection.syncFrequencyMinutes || 15));
  const [conflictResolution, setConflictResolution] = useState(connection.conflictResolution || "latest_wins");

  const updateMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/calendar/integrations/${connection.id}`, {
        syncDirection: direction,
        syncFrequencyMinutes: Number(frequency),
        conflictResolution,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/integrations"] });
      toast({ title: "Settings saved" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isCalDav = connection.provider === "caldav" || connection.provider === "apple";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sync Settings</DialogTitle>
          <DialogDescription>
            Configure sync direction and frequency for this calendar integration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label data-testid="label-sync-direction">Sync Direction</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger data-testid="select-sync-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Two-way (pull + push)</SelectItem>
                <SelectItem value="pull">Pull only (read from provider)</SelectItem>
                <SelectItem value="push">Push only (send to provider)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pull imports events from your external calendar. Push sends Cortex events out.
            </p>
          </div>

          {isCalDav && (
            <div className="space-y-2">
              <Label data-testid="label-conflict-resolution-settings">Conflict Resolution</Label>
              <Select value={conflictResolution} onValueChange={setConflictResolution}>
                <SelectTrigger data-testid="select-conflict-resolution-settings">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest_wins">Latest update wins</SelectItem>
                  <SelectItem value="provider_wins">Provider always wins</SelectItem>
                  <SelectItem value="cortex_wins">Cortex always wins</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which version to keep when the same event is edited in both places.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label data-testid="label-sync-frequency">Sync Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger data-testid="select-sync-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">Every 5 minutes</SelectItem>
                <SelectItem value="15">Every 15 minutes</SelectItem>
                <SelectItem value="30">Every 30 minutes</SelectItem>
                <SelectItem value="60">Every hour</SelectItem>
                <SelectItem value="360">Every 6 hours</SelectItem>
                <SelectItem value="1440">Once a day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} data-testid="button-settings-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            data-testid="button-settings-save"
          >
            {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Provider Card ────────────────────────────────────────────────────────────

function ProviderCard({
  providerKey,
  label,
  description,
  Icon,
  iconClass,
  connection,
  onConnect,
  onDisconnect,
  onSync,
  syncing,
  comingSoon,
}: {
  providerKey: string;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  connection?: CalendarConnection;
  onConnect: () => void;
  onDisconnect: (id: number) => void;
  onSync: (id: number) => void;
  syncing: number | null;
  comingSoon?: boolean;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const isConnected = !!connection;
  const lastSync = connection?.lastSyncedAt
    ? formatDistanceToNow(new Date(connection.lastSyncedAt), { addSuffix: true })
    : null;

  return (
    <>
      {connection && showSettings && (
        <SyncSettingsDialog connection={connection} onClose={() => setShowSettings(false)} />
      )}
      <div
        className={`flex items-start justify-between p-4 rounded-xl border ${
          isConnected
            ? "border-primary/30 bg-primary/5"
            : "border-border/50 bg-card"
        } transition-colors`}
        data-testid={`provider-card-${providerKey}`}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            comingSoon ? "bg-muted/50" : isConnected ? "bg-primary/10" : "bg-muted/30"
          }`}>
            <Icon className={`h-5 w-5 ${iconClass || (comingSoon ? "text-muted-foreground" : isConnected ? "text-primary" : "text-muted-foreground")}`} />
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{label}</p>
              {comingSoon && (
                <Badge variant="outline" className="text-xs text-muted-foreground border-border/50">
                  Coming Soon
                </Badge>
              )}
              {isConnected && !comingSoon && (
                <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border" variant="outline">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                </Badge>
              )}
              {connection?.syncError && (
                <Badge variant="outline" className="text-xs text-red-400 border-red-500/30">
                  <AlertCircle className="mr-1 h-3 w-3" /> Sync Error
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            {isConnected && (
              <div className="text-xs text-muted-foreground space-y-1 mt-1.5">
                {connection.accountEmail && (
                  <p className="truncate max-w-[220px]" data-testid={`text-account-email-${providerKey}`}>
                    {connection.accountEmail}
                  </p>
                )}

                {/* Sync info row */}
                <p className="text-muted-foreground/60" data-testid={`text-sync-direction-${providerKey}`}>
                  {connection.syncDirection === "pull"
                    ? "Pull only"
                    : connection.syncDirection === "push"
                    ? "Push only"
                    : "Two-way sync"}{" "}
                  · every {connection.syncFrequencyMinutes || 15}m
                  {connection.conflictResolution && connection.conflictResolution !== "latest_wins" && (
                    <span className="ml-1 opacity-75">
                      · {connection.conflictResolution === "provider_wins" ? "provider wins" : "cortex wins"}
                    </span>
                  )}
                </p>

                {/* Last sync */}
                {lastSync && (
                  <p className="flex items-center gap-1" data-testid={`text-last-sync-${providerKey}`}>
                    <Clock className="h-3 w-3" /> Last sync {lastSync}
                  </p>
                )}
                {!lastSync && (
                  <p className="text-muted-foreground/50" data-testid={`text-no-sync-${providerKey}`}>Never synced</p>
                )}

                {/* Sync error */}
                {connection.syncError && (
                  <p className="flex items-start gap-1 text-red-400 max-w-[260px]" data-testid={`text-sync-error-${providerKey}`}>
                    <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="truncate">{connection.syncError}</span>
                  </p>
                )}

                {/* Discovered calendars */}
                {connection.calendarsDiscovered && connection.calendarsDiscovered.length > 0 && (
                  <div className="mt-1.5 space-y-0.5" data-testid={`text-calendars-discovered-${providerKey}`}>
                    <p className="text-muted-foreground/50 uppercase tracking-wide text-[10px] font-medium">
                      {connection.calendarsDiscovered.length} calendar{connection.calendarsDiscovered.length !== 1 ? "s" : ""} on server
                    </p>
                    {connection.calendarsDiscovered.slice(0, 3).map((cal, i) => (
                      <p key={i} className="flex items-center gap-1.5 text-muted-foreground/70">
                        {cal.color ? (
                          <span className="w-2 h-2 rounded-full shrink-0 inline-block" style={{ background: cal.color }} />
                        ) : (
                          <CalendarCheck className="h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate max-w-[200px]">{cal.name}</span>
                        {cal.url === connection.defaultCalendarId && (
                          <span className="text-primary/70 text-[10px]">active</span>
                        )}
                      </p>
                    ))}
                    {connection.calendarsDiscovered.length > 3 && (
                      <p className="text-muted-foreground/40">
                        +{connection.calendarsDiscovered.length - 3} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {comingSoon ? null : isConnected ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettings(true)}
                title="Sync settings"
                data-testid={`button-settings-${providerKey}`}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={() => onSync(connection!.id)}
                disabled={syncing === connection!.id}
                title="Sync now"
                data-testid={`button-sync-${providerKey}`}
              >
                {syncing === connection!.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                onClick={() => onDisconnect(connection!.id)}
                title="Disconnect"
                data-testid={`button-disconnect-${providerKey}`}
              >
                <Link2Off className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onConnect}
              className="h-8 text-xs"
              data-testid={`button-connect-${providerKey}`}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Connect
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

// ─── Team Calendar Health (admin-only) ────────────────────────────────────────

type TeamUserHealth = {
  id: number;
  name: string;
  email: string;
  globalRole: string;
  connections: Array<{
    id: number;
    provider: string;
    displayName: string | null;
    accountEmail: string | null;
    isActive: boolean;
    syncEnabled: boolean;
    syncDirection: string | null;
    lastSyncedAt: string | null;
    syncError: string | null;
  }>;
};

function TeamCalendarHealthSection() {
  const { data, isLoading, isError } = useQuery<TeamUserHealth[]>({
    queryKey: ["/api/calendar/connections/team"],
    queryFn: async () => {
      const res = await fetch("/api/calendar/connections/team", { credentials: "include" });
      if (!res.ok) throw new Error("Not admin");
      return res.json();
    },
    retry: false,
  });

  // Only render for admins
  if (isError || (!isLoading && !data)) return null;

  const PROVIDER_LABELS: Record<string, string> = {
    google: "Google", apple: "iCloud", caldav: "CalDAV", microsoft: "Microsoft",
  };

  return (
    <Card className="border-border/50" data-testid="team-calendar-health">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Team Calendar Health</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Calendar connection status for all team members
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading team data…
          </div>
        )}
        {data && (
          <div className="space-y-3">
            {data.map(user => {
              const hasConnections = user.connections.length > 0;
              const hasError = user.connections.some(c => c.syncError);

              return (
                <div key={user.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 bg-card" data-testid={`team-health-user-${user.id}`}>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {user.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{user.name}</p>
                      {user.globalRole === "master_admin" && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/30 text-primary">Admin</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{user.email}</p>

                    {!hasConnections && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                        <WifiOff className="h-3.5 w-3.5" />
                        <span>No calendar connected</span>
                      </div>
                    )}

                    {user.connections.map(conn => (
                      <div key={conn.id} className="mt-1.5 flex items-center gap-2 text-xs">
                        {conn.syncError ? (
                          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        ) : conn.isActive ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <WifiOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium">{PROVIDER_LABELS[conn.provider] || conn.provider}</span>
                        {conn.accountEmail && <span className="text-muted-foreground truncate">{conn.accountEmail}</span>}
                        {conn.lastSyncedAt && (
                          <span className="text-muted-foreground shrink-0">
                            synced {formatDistanceToNow(new Date(conn.lastSyncedAt), { addSuffix: true })}
                          </span>
                        )}
                        {conn.syncError && (
                          <span className="text-red-400 truncate" title={conn.syncError}>Error</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="shrink-0 mt-0.5">
                    {hasError ? (
                      <Badge variant="outline" className="text-xs border-red-500/30 text-red-400">Error</Badge>
                    ) : hasConnections ? (
                      <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Not set up</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [supported, setSupported] = useState(false);
  const [caldavDialog, setCaldavDialog] = useState<"apple" | "caldav" | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!window.PublicKeyCredential &&
        typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    );
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    try {
      const res = await fetch("/api/webauthn/credentials", { credentials: "include" });
      if (res.ok) setCredentials(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  };

  // Calendar integrations
  const { data: integrations = [], isLoading: integrationsLoading } = useQuery<CalendarConnection[]>({
    queryKey: ["/api/calendar/integrations"],
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/calendar/integrations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/integrations"] });
      toast({ title: "Disconnected", description: "Calendar integration removed." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleConnect = async (provider: "google" | "apple" | "caldav" | "microsoft") => {
    if (provider === "google") {
      try {
        const res = await fetch("/api/calendar/integrations/google/auth-url", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to get auth URL");
        const { url } = await res.json();
        window.location.href = url;
      } catch (e: any) {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    } else if (provider === "apple") {
      setCaldavDialog("apple");
    } else if (provider === "caldav") {
      setCaldavDialog("caldav");
    }
  };

  const handleSync = async (connectionId: number) => {
    setSyncingId(connectionId);
    try {
      const res = await fetch(`/api/calendar/integrations/${connectionId}/sync`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Sync failed");
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/integrations"] });
      toast({
        title: "Sync complete",
        description: `Imported ${data.imported ?? 0} · Updated ${data.updated ?? 0} · Pushed ${data.pushed ?? 0}`,
      });
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  };

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const optionsRes = await fetch("/api/webauthn/register-options", {
        method: "POST",
        credentials: "include",
      });
      if (!optionsRes.ok) throw new Error("Failed to get registration options");
      const options = await optionsRes.json();
      const registration = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(registration),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json();
        throw new Error(data.message || "Verification failed");
      }
      toast({ title: "Biometric registered", description: "You can now use Face ID / Touch ID to sign in." });
      fetchCredentials();
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        toast({
          title: "Registration cancelled",
          description: "The biometric prompt was dismissed. If you're using an embedded preview, try opening the app in a full browser tab instead.",
          variant: "destructive",
        });
      } else if (e.name === "InvalidStateError") {
        toast({
          title: "Already registered",
          description: "This device already has a biometric credential registered.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Registration failed", description: e.message, variant: "destructive" });
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (credId: number) => {
    setDeleting(credId);
    try {
      const res = await fetch(`/api/webauthn/credentials/${credId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove");
      setCredentials((prev) => prev.filter((c) => c.id !== credId));
      toast({ title: "Removed", description: "Biometric credential has been removed." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  const googleConn = integrations.find((c) => c.provider === "google");
  const appleConn = integrations.find((c) => c.provider === "apple");
  const caldavConn = integrations.find((c) => c.provider === "caldav");

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your account and security preferences.</p>
      </div>

      {/* ── Calendar Integrations ─────────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Calendar Integrations</CardTitle>
              <CardDescription>
                Sync your external calendars with Cortex. Events will appear on your calendar page.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {integrationsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
            </div>
          ) : (
            <>
              <ProviderCard
                providerKey="google"
                label="Google Calendar"
                description="Sync with Google Calendar. Supports two-way sync — pull events in and push Cortex events out."
                Icon={SiGooglecalendar}
                iconClass={googleConn ? "text-[#4285f4]" : "text-muted-foreground"}
                connection={googleConn}
                onConnect={() => handleConnect("google")}
                onDisconnect={(id) => disconnectMutation.mutate(id)}
                onSync={handleSync}
                syncing={syncingId}
              />

              <ProviderCard
                providerKey="apple"
                label="Apple iCloud Calendar"
                description="Connect via CalDAV with an app-specific password from appleid.apple.com. Pull-only sync."
                Icon={Apple}
                iconClass={appleConn ? "text-foreground" : "text-muted-foreground"}
                connection={appleConn}
                onConnect={() => handleConnect("apple")}
                onDisconnect={(id) => disconnectMutation.mutate(id)}
                onSync={handleSync}
                syncing={syncingId}
              />

              <ProviderCard
                providerKey="microsoft"
                label="Microsoft 365 / Outlook"
                description="Connect Outlook Calendar via Microsoft OAuth. Requires Azure app registration."
                Icon={CalendarDays}
                iconClass="text-muted-foreground"
                connection={undefined}
                onConnect={() => {}}
                onDisconnect={() => {}}
                onSync={() => {}}
                syncing={null}
                comingSoon
              />

              <ProviderCard
                providerKey="caldav"
                label="Generic CalDAV"
                description="Connect any CalDAV-compatible calendar server (Fastmail, Nextcloud, Zimbra, etc.)."
                Icon={CalendarDays}
                iconClass={caldavConn ? "text-primary" : "text-muted-foreground"}
                connection={caldavConn}
                onConnect={() => handleConnect("caldav")}
                onDisconnect={(id) => disconnectMutation.mutate(id)}
                onSync={handleSync}
                syncing={syncingId}
              />
            </>
          )}

          <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 mt-2">
            Calendar sync imports events from the past 2 months and next 6 months. Syncing runs automatically in the background.
          </div>
        </CardContent>
      </Card>

      {/* ── Biometric Authentication ──────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Biometric Authentication</CardTitle>
              <CardDescription>
                Use Face ID, Touch ID, or Windows Hello for faster and more secure sign-in.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supported ? (
            <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4" data-testid="text-biometric-unsupported">
              Biometric authentication is not supported on this device or browser.
              Try using Safari on iPhone/Mac, Chrome on Android, or Edge on Windows.
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2" data-testid="text-biometric-tip">
                Tip: For best results, open the app in a full browser tab (not an embedded preview). Use Safari on iPhone/Mac, Chrome on Android, or Edge on Windows.
              </div>
              <Button
                onClick={handleRegister}
                disabled={registering}
                className="bg-primary text-primary-foreground"
                data-testid="button-register-biometric"
              >
                {registering ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering...</>
                ) : (
                  <><Fingerprint className="mr-2 h-4 w-4" /> Register Face ID / Biometric</>
                )}
              </Button>

              {loading ? (
                <div className="text-sm text-muted-foreground">Loading credentials...</div>
              ) : credentials.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4" data-testid="text-no-credentials">
                  No biometric credentials registered yet. Register one above to enable
                  passwordless sign-in on this device.
                </div>
              ) : (
                <div className="space-y-2" data-testid="list-credentials">
                  <p className="text-sm font-medium text-muted-foreground">Registered Devices</p>
                  {credentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
                      data-testid={`credential-${cred.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{cred.deviceName || "Biometric Device"}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(cred.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">Active</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(cred.id)}
                          disabled={deleting === cred.id}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                          data-testid={`button-delete-credential-${cred.id}`}
                        >
                          {deleting === cred.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Team Calendar Health — admin only */}
      <TeamCalendarHealthSection />

      {/* CalDAV connect dialogs */}
      {caldavDialog && (
        <CalDavConnectDialog
          open
          provider={caldavDialog}
          onClose={() => setCaldavDialog(null)}
        />
      )}
    </div>
  );
}
