import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, X, Loader2, User, Building2, Briefcase, ExternalLink } from "lucide-react";

// ─── Shared badge/toggle component ───────────────────────────────────────────

interface InvestorTagProps {
  recordType: "lead" | "account" | "contact";
  recordId: number;
  sourceThreadId?: string;
  sourceMessageId?: string;
  compact?: boolean;
}

export function PotentialInvestorBadge({
  recordType, recordId, sourceThreadId, sourceMessageId, compact = false,
}: InvestorTagProps) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ tagged: boolean; tag: any }>({
    queryKey: ["/api/investor-tags", recordType, recordId],
    queryFn: async () => {
      const res = await fetch(
        `/api/investor-tags?recordType=${recordType}&recordId=${recordId}`,
        { credentials: "include" }
      );
      return res.json();
    },
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/investor-tags", {
        recordType, recordId, sourceThreadId, sourceMessageId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor-tags"] });
      toast({ title: "Tagged as Potential Investor" });
    },
    onError: () => toast({ title: "Failed to apply tag", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/investor-tags/${recordType}/${recordId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor-tags"] });
      toast({ title: "Investor tag removed" });
    },
    onError: () => toast({ title: "Failed to remove tag", variant: "destructive" }),
  });

  const isPending = addMutation.isPending || removeMutation.isPending;

  if (isLoading) return <Skeleton className="h-5 w-32 rounded-full" />;

  if (data?.tagged) {
    return (
      <div
        className="flex items-center gap-1"
        data-testid={`investor-tag-${recordType}-${recordId}`}
      >
        <Badge className="bg-teal-500/15 text-teal-300 border border-teal-500/30 text-[11px] font-medium flex items-center gap-1 px-2 py-0.5 h-auto">
          <TrendingUp className="h-3 w-3 flex-shrink-0" />
          {!compact && "Potential Investor"}
          {compact && "Investor"}
        </Badge>
        <button
          onClick={() => removeMutation.mutate()}
          disabled={isPending}
          className="h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          title="Remove Potential Investor tag"
          data-testid={`button-remove-investor-tag-${recordType}-${recordId}`}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => addMutation.mutate()}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-teal-400 border border-dashed border-transparent hover:border-teal-500/40 hover:bg-teal-500/8 px-2 py-0.5 rounded-full transition-all"
      title="Tag as Potential Investor"
      data-testid={`button-add-investor-tag-${recordType}-${recordId}`}
    >
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
      Tag as Potential Investor
    </button>
  );
}

// ─── Single record row used inside the email dialog ───────────────────────────

function InvestorTagRow({
  type, id, name, detail, threadId, messageId,
}: {
  type: "lead" | "account" | "contact";
  id: number;
  name: string;
  detail?: string;
  threadId?: string;
  messageId?: string;
}) {
  const TypeIcon = type === "lead" ? Briefcase : type === "account" ? Building2 : User;
  const typeLabel = type === "lead" ? "Lead" : type === "account" ? "Account" : "Contact";
  const typeColor = type === "lead"
    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
    : type === "account"
    ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
    : "bg-purple-500/10 text-purple-400 border-purple-500/30";
  const href = type === "lead"
    ? `/opportunities/${id}`
    : type === "account"
    ? `/accounts/${id}`
    : `/contacts/${id}`;

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-secondary/30 border border-border/30">
      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${typeColor} flex-shrink-0`}>
        <TypeIcon className="h-3 w-3" />
        {typeLabel}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{name}</span>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/40 hover:text-primary transition-colors flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
      </div>
      <div className="flex-shrink-0">
        <PotentialInvestorBadge
          recordType={type}
          recordId={id}
          sourceThreadId={threadId}
          sourceMessageId={messageId}
        />
      </div>
    </div>
  );
}

// ─── Email-based lookup dialog (used in Gmail inbox) ─────────────────────────

interface InvestorTagFromEmailDialogProps {
  open: boolean;
  onClose: () => void;
  senderEmail?: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  linkedLead?: { id: number; company?: string; contactName?: string; contactEmail?: string; status?: string } | null;
  linkedContact?: { id: number; name?: string; email?: string; firstName?: string; lastName?: string } | null;
  linkedAccount?: { id: number; name?: string; website?: string; orgType?: string } | null;
}

export function InvestorTagFromEmailDialog({
  open, onClose, senderEmail, senderName, threadId, messageId,
  linkedLead, linkedContact, linkedAccount,
}: InvestorTagFromEmailDialogProps) {
  const hasLinked = !!(linkedLead || linkedContact || linkedAccount);

  const { data: lookupData, isLoading: lookupLoading } = useQuery<{
    leads: any[];
    accounts: any[];
    contacts: any[];
  }>({
    queryKey: ["/api/investor-tags/sender-lookup", senderEmail],
    queryFn: async () => {
      if (!senderEmail) return { leads: [], accounts: [], contacts: [] };
      const res = await fetch(
        `/api/investor-tags/sender-lookup?email=${encodeURIComponent(senderEmail)}`,
        { credentials: "include" }
      );
      return res.json();
    },
    enabled: open && !!senderEmail,
    staleTime: 30_000,
  });

  const linkedIds = {
    leads: linkedLead ? [linkedLead.id] : [],
    contacts: linkedContact ? [linkedContact.id] : [],
    accounts: linkedAccount ? [linkedAccount.id] : [],
  };

  const extraLeads = (lookupData?.leads ?? []).filter(r => !linkedIds.leads.includes(r.id));
  const extraContacts = (lookupData?.contacts ?? []).filter(r => !linkedIds.contacts.includes(r.id));
  const extraAccounts = (lookupData?.accounts ?? []).filter(r => !linkedIds.accounts.includes(r.id));

  const hasEmailMatches = extraLeads.length > 0 || extraContacts.length > 0 || extraAccounts.length > 0;
  const hasAnything = hasLinked || hasEmailMatches;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-400" />
            Tag as Potential Investor
          </DialogTitle>
          <DialogDescription>
            Manually apply or remove the Potential Investor tag on CRM records. Never applied automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Linked thread records */}
          {hasLinked && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Linked to this thread</p>
              <div className="space-y-1.5">
                {linkedLead && (
                  <InvestorTagRow
                    type="lead" id={linkedLead.id}
                    name={linkedLead.company ?? `Lead #${linkedLead.id}`}
                    detail={linkedLead.contactEmail ?? linkedLead.contactName ?? undefined}
                    threadId={threadId} messageId={messageId}
                  />
                )}
                {linkedContact && (
                  <InvestorTagRow
                    type="contact" id={linkedContact.id}
                    name={linkedContact.name ?? `${linkedContact.firstName ?? ""} ${linkedContact.lastName ?? ""}`.trim() || `Contact #${linkedContact.id}`}
                    detail={linkedContact.email ?? undefined}
                    threadId={threadId} messageId={messageId}
                  />
                )}
                {linkedAccount && (
                  <InvestorTagRow
                    type="account" id={linkedAccount.id}
                    name={linkedAccount.name ?? `Account #${linkedAccount.id}`}
                    detail={linkedAccount.website ?? undefined}
                    threadId={threadId} messageId={messageId}
                  />
                )}
              </div>
            </div>
          )}

          {/* Email-matched records */}
          {lookupLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          )}

          {!lookupLoading && hasEmailMatches && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Matches for {senderEmail}
              </p>
              <div className="space-y-1.5">
                {extraLeads.map((r: any) => (
                  <InvestorTagRow key={`l-${r.id}`} type="lead" id={r.id} name={r.name} detail={r.email ?? undefined} threadId={threadId} messageId={messageId} />
                ))}
                {extraContacts.map((r: any) => (
                  <InvestorTagRow key={`c-${r.id}`} type="contact" id={r.id} name={r.name} detail={r.email ?? undefined} threadId={threadId} messageId={messageId} />
                ))}
                {extraAccounts.map((r: any) => (
                  <InvestorTagRow key={`a-${r.id}`} type="account" id={r.id} name={r.name} detail={r.email ?? undefined} threadId={threadId} messageId={messageId} />
                ))}
              </div>
            </div>
          )}

          {!lookupLoading && !hasAnything && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="font-medium">No CRM record linked yet</p>
              <p className="text-xs mt-1">Use <span className="font-medium">Add Contact</span> or <span className="font-medium">New Lead</span> to create a record, then tag it as a Potential Investor.</p>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
