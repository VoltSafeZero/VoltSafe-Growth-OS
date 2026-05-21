import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";

export type TrustEvent = {
  type:
    | "sending"
    | "sent"
    | "draft-saving"
    | "draft-saved"
    | "send-failed-draft-saved"
    | "send-failed"
    | "scheduled-failed";
  at: number;
};

type Props = {
  authStatus: string | null;
  lastSyncAt: string | null;
  healthStatus: "green" | "amber" | "red" | null;
  syncErrorMessage: string | null;
  trustEvent: TrustEvent | null;
  hasFailedScheduled?: boolean;
  isLoading?: boolean;
};

export function MailTrustStrip({
  authStatus,
  lastSyncAt,
  healthStatus,
  syncErrorMessage,
  trustEvent,
  hasFailedScheduled = false,
  isLoading = false,
}: Props) {
  let dotColor = "bg-emerald-400";
  let label = "Connected to Gmail";
  let labelColor = "text-muted-foreground/70";
  let showSpinner = false;
  let showReconnect = false;

  // Show a stable neutral state while accountsQuery is initially loading — prevents
  // a brief "Gmail reconnect required" flash before account data arrives.
  if (isLoading) {
    dotColor = "bg-muted-foreground/30";
    label = "Checking…";
    labelColor = "text-muted-foreground/40";
  } else if (trustEvent?.type === "sending") {
    dotColor = "bg-amber-400";
    label = "Sending…";
    labelColor = "text-amber-300/90";
    showSpinner = true;
  } else if (trustEvent?.type === "sent") {
    dotColor = "bg-emerald-400";
    label = "Sent";
    labelColor = "text-emerald-400/90";
  } else if (trustEvent?.type === "draft-saving") {
    dotColor = "bg-amber-400/70";
    label = "Saving draft…";
    labelColor = "text-amber-300/80";
    showSpinner = true;
  } else if (trustEvent?.type === "draft-saved") {
    dotColor = "bg-emerald-400";
    label = "Draft saved";
    labelColor = "text-emerald-400/80";
  } else if (trustEvent?.type === "send-failed-draft-saved") {
    dotColor = "bg-amber-400";
    label = "Send failed — saved as draft";
    labelColor = "text-amber-300";
  } else if (trustEvent?.type === "send-failed") {
    dotColor = "bg-red-400";
    label = "Send failed";
    labelColor = "text-red-400/90";
  } else if (trustEvent?.type === "scheduled-failed") {
    dotColor = "bg-red-400";
    label = "Scheduled send failed";
    labelColor = "text-red-400/90";
  } else if (!authStatus || authStatus === "expired" || authStatus === "revoked") {
    dotColor = "bg-red-400";
    label = "Gmail reconnect required";
    labelColor = "text-red-400/90";
    showReconnect = true;
  } else if (healthStatus === "red") {
    dotColor = "bg-red-400";
    label = "Sync error";
    labelColor = "text-red-400/80";
  } else if (healthStatus === "amber") {
    dotColor = "bg-amber-400";
    label = "Sync delayed";
    labelColor = "text-amber-300/80";
  } else if (hasFailedScheduled) {
    dotColor = "bg-red-400";
    label = "Scheduled send failed";
    labelColor = "text-red-400/80";
  } else {
    let syncStr = "";
    if (lastSyncAt) {
      try {
        syncStr = " · " + formatDistanceToNow(new Date(lastSyncAt), { addSuffix: true });
      } catch {
        syncStr = "";
      }
    }
    label = lastSyncAt ? `Connected to Gmail${syncStr}` : "Connected to Gmail";
    labelColor = "text-muted-foreground/60";
  }

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/25 min-w-0"
      data-testid="mail-trust-strip"
    >
      {showSpinner ? (
        <Loader2
          className="h-2 w-2 text-amber-400 animate-spin flex-shrink-0"
          data-testid="trust-spinner"
        />
      ) : (
        <span
          className={`flex-shrink-0 h-1.5 w-1.5 rounded-full ${dotColor}`}
          data-testid="trust-dot"
        />
      )}
      <span
        className={`text-[10px] leading-none truncate flex-1 tabular-nums ${labelColor}`}
        data-testid="trust-label"
      >
        {label}
      </span>
      {showReconnect && (
        <a
          href="/api/auth/gmail/connect"
          className="flex-shrink-0 text-[10px] font-medium text-amber-300 hover:text-amber-200 underline underline-offset-2 transition-colors"
          data-testid="trust-reconnect-link"
        >
          Reconnect
        </a>
      )}
    </div>
  );
}
