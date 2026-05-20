import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Building2, Target, X, Search, Plus } from "lucide-react";
import { EmailAutocompleteInput } from "@/components/email/email-autocomplete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ContactRecord = {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  persona?: string | null;
  role_type?: string | null;
  preferred_contact_method?: string | null;
  relationship_strength?: string | null;
  is_primary?: boolean | null;
  notes?: string | null;
};

type FormState = {
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  persona: string;
  roleType: string;
  preferredContactMethod: string;
  relationshipStrength: string;
  isPrimary: boolean;
  notes: string;
};

const STRENGTH_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "weak", label: "Weak" },
  { value: "developing", label: "Developing" },
  { value: "good", label: "Good" },
  { value: "strong", label: "Strong" },
];

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "No preference" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "sms", label: "Text / SMS" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "in_person", label: "In person" },
];

const ROLE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "—" },
  { value: "decision_maker", label: "Decision maker" },
  { value: "champion", label: "Champion" },
  { value: "influencer", label: "Influencer" },
  { value: "user", label: "End user" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "technical", label: "Technical" },
  { value: "finance", label: "Finance" },
  { value: "executive", label: "Executive" },
];

function deriveFromName(name?: string | null): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildInitial(c: ContactRecord | null | undefined): FormState {
  const derived = deriveFromName(c?.name);
  return {
    firstName: c?.first_name ?? derived.first ?? "",
    lastName: c?.last_name ?? derived.last ?? "",
    title: c?.title ?? "",
    email: c?.email ?? "",
    phone: c?.phone ?? "",
    linkedinUrl: c?.linkedin_url ?? "",
    persona: c?.persona ?? "",
    roleType: c?.role_type ?? "none",
    preferredContactMethod: c?.preferred_contact_method ?? "none",
    relationshipStrength: c?.relationship_strength ?? "unknown",
    isPrimary: !!c?.is_primary,
    notes: c?.notes ?? "",
  };
}

export function EditContactDialog({
  open,
  onOpenChange,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactRecord | null | undefined;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => buildInitial(contact));
  const [acctSearch, setAcctSearch] = useState("");
  const [leadSearch, setLeadSearch] = useState("");

  // Keep form in sync if a different contact gets passed in or the dialog re-opens.
  useEffect(() => {
    if (open) {
      setForm(buildInitial(contact));
      setAcctSearch("");
      setLeadSearch("");
    }
  }, [open, contact?.id]);

  const cid = contact?.id;

  // ── Linked accounts & leads ────────────────────────────────────────────
  const { data: linkedAccounts = [], refetch: refetchLinkedAccounts } = useQuery<any[]>({
    queryKey: ["/api/contacts", cid, "accounts"],
    queryFn: () => fetch(`/api/contacts/${cid}/accounts`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!cid,
  });
  const { data: linkedLeads = [], refetch: refetchLinkedLeads } = useQuery<any[]>({
    queryKey: ["/api/contacts", cid, "leads"],
    queryFn: () => fetch(`/api/contacts/${cid}/leads`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!cid,
  });

  // ── Account search results ─────────────────────────────────────────────
  const { data: acctResultsRaw } = useQuery<any>({
    queryKey: ["/api/accounts", { search: acctSearch }],
    queryFn: () => fetch(`/api/accounts?search=${encodeURIComponent(acctSearch)}&limit=8`, { credentials: "include" }).then(r => r.json()),
    enabled: open && acctSearch.trim().length > 0,
    staleTime: 10_000,
  });
  const acctResults: any[] = acctResultsRaw?.data ?? [];

  // ── Lead search results ────────────────────────────────────────────────
  const { data: leadResultsRaw } = useQuery<any>({
    queryKey: ["/api/leads", { search: leadSearch }],
    queryFn: () => fetch(`/api/leads?search=${encodeURIComponent(leadSearch)}&limit=8`, { credentials: "include" }).then(r => r.json()),
    enabled: open && leadSearch.trim().length > 0,
    staleTime: 10_000,
  });
  const leadResults: any[] = leadResultsRaw?.data ?? [];

  const linkedAccountIds = new Set((linkedAccounts as any[]).map((a: any) => a.accountId));
  const linkedLeadIds = new Set((linkedLeads as any[]).map((l: any) => l.leadId));

  // ── Link / unlink mutations ────────────────────────────────────────────
  const linkAcct = useMutation({
    mutationFn: (accountId: number) => apiRequest("POST", `/api/accounts/${accountId}/contacts`, { contactId: cid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", cid, "accounts"] });
      setAcctSearch("");
      toast({ title: "Organization linked" });
    },
    onError: (e: any) => toast({ title: "Could not link organization", description: e?.message, variant: "destructive" }),
  });
  const unlinkAcct = useMutation({
    mutationFn: (accountId: number) => apiRequest("DELETE", `/api/accounts/${accountId}/contacts/${cid}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", cid, "accounts"] });
      toast({ title: "Organization unlinked" });
    },
    onError: (e: any) => toast({ title: "Could not unlink", description: e?.message, variant: "destructive" }),
  });
  const linkLead = useMutation({
    mutationFn: (leadId: number) => apiRequest("POST", `/api/leads/${leadId}/contacts`, { contactId: cid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", cid, "leads"] });
      setLeadSearch("");
      toast({ title: "Lead linked" });
    },
    onError: (e: any) => toast({ title: "Could not link lead", description: e?.message, variant: "destructive" }),
  });
  const unlinkLead = useMutation({
    mutationFn: (leadId: number) => apiRequest("DELETE", `/api/leads/${leadId}/contacts/${cid}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", cid, "leads"] });
      toast({ title: "Lead unlinked" });
    },
    onError: (e: any) => toast({ title: "Could not unlink", description: e?.message, variant: "destructive" }),
  });

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!contact?.id) throw new Error("Missing contact id");
      const first = form.firstName.trim();
      const last = form.lastName.trim();
      const fullName = [first, last].filter(Boolean).join(" ").trim();
      if (!fullName) throw new Error("First or last name is required");

      const body: Record<string, any> = {
        firstName: first || null,
        lastName: last || null,
        name: fullName,
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        linkedinUrl: form.linkedinUrl.trim() || null,
        persona: form.persona.trim() || null,
        roleType: form.roleType === "none" ? null : form.roleType,
        preferredContactMethod:
          form.preferredContactMethod === "none" ? null : form.preferredContactMethod,
        relationshipStrength:
          form.relationshipStrength === "unknown" ? null : form.relationshipStrength,
        isPrimary: form.isPrimary,
        notes: form.notes.trim() || null,
      };
      return await apiRequest("PUT", `/api/contacts/${contact.id}`, body);
    },
    onSuccess: () => {
      toast({ title: "Contact updated" });
      // Invalidate the most common contact-related cache keys.
      if (contact?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact.id] });
        queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}/profile`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save changes",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-edit-contact"
      >
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
          <DialogDescription>
            Update {contact?.name || "this contact"}'s details. Changes save instantly.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-first">First name *</Label>
              <Input
                id="edit-contact-first"
                value={form.firstName}
                onChange={(e) => setField("firstName", e.target.value)}
                data-testid="input-edit-contact-first-name"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-last">Last name</Label>
              <Input
                id="edit-contact-last"
                value={form.lastName}
                onChange={(e) => setField("lastName", e.target.value)}
                data-testid="input-edit-contact-last-name"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-title">Title</Label>
            <Input
              id="edit-contact-title"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="e.g. Marina Manager"
              data-testid="input-edit-contact-title"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-email">Email</Label>
              <EmailAutocompleteInput
                id="edit-contact-email"
                value={form.email}
                onChange={(v) => setField("email", v)}
                placeholder="name@example.com"
                data-testid="input-edit-contact-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-contact-phone">Phone</Label>
              <Input
                id="edit-contact-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="+1 555 123 4567"
                data-testid="input-edit-contact-phone"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-linkedin">LinkedIn URL</Label>
            <Input
              id="edit-contact-linkedin"
              type="url"
              value={form.linkedinUrl}
              onChange={(e) => setField("linkedinUrl", e.target.value)}
              placeholder="https://linkedin.com/in/…"
              data-testid="input-edit-contact-linkedin"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Role type</Label>
              <Select
                value={form.roleType}
                onValueChange={(v) => setField("roleType", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-role-type">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Preferred contact</Label>
              <Select
                value={form.preferredContactMethod}
                onValueChange={(v) => setField("preferredContactMethod", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-pref-method">
                  <SelectValue placeholder="No preference" />
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Relationship</Label>
              <Select
                value={form.relationshipStrength}
                onValueChange={(v) => setField("relationshipStrength", v)}
              >
                <SelectTrigger data-testid="select-edit-contact-strength">
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent>
                  {STRENGTH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-persona">Persona</Label>
            <Input
              id="edit-contact-persona"
              value={form.persona}
              onChange={(e) => setField("persona", e.target.value)}
              placeholder="e.g. Operations lead, Technical buyer"
              data-testid="input-edit-contact-persona"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="edit-contact-primary"
              checked={form.isPrimary}
              onCheckedChange={(v) => setField("isPrimary", v === true)}
              data-testid="checkbox-edit-contact-primary"
            />
            <Label
              htmlFor="edit-contact-primary"
              className="text-sm font-normal cursor-pointer"
            >
              Primary contact for this account
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-contact-notes">Notes</Label>
            <Textarea
              id="edit-contact-notes"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={4}
              placeholder="Anything useful to remember about this person…"
              data-testid="textarea-edit-contact-notes"
            />
          </div>

          {/* ── Relationships ───────────────────────────────────────────── */}
          {cid && (
            <div className="space-y-4 pt-3 border-t border-border/50" data-testid="section-contact-relationships">
              <p className="text-sm font-medium text-foreground">Relationships</p>

              {/* Organizations */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Organizations</span>
                </div>
                {/* Linked accounts list */}
                <div className="space-y-1">
                  {(linkedAccounts as any[]).map((a: any) => (
                    <div key={a.accountId} className="flex items-center justify-between py-1 px-2 rounded bg-muted/40 text-xs" data-testid={`linked-account-${a.accountId}`}>
                      <span className="font-medium truncate">{a.accountName}</span>
                      <button
                        type="button"
                        onClick={() => unlinkAcct.mutate(a.accountId)}
                        disabled={unlinkAcct.isPending}
                        className="ml-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        data-testid={`button-unlink-account-${a.accountId}`}
                        title="Remove link"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {(linkedAccounts as any[]).length === 0 && (
                    <p className="text-xs text-muted-foreground pl-1">No organizations linked yet.</p>
                  )}
                </div>
                {/* Account search */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={acctSearch}
                    onChange={e => setAcctSearch(e.target.value)}
                    placeholder="Search to link an organization…"
                    className="h-7 text-xs pl-7"
                    data-testid="input-link-account-search"
                  />
                </div>
                {acctSearch.trim().length > 0 && acctResults.length > 0 && (
                  <div className="border border-border rounded-md max-h-36 overflow-y-auto divide-y divide-border/50">
                    {acctResults
                      .filter((a: any) => !linkedAccountIds.has(a.id))
                      .slice(0, 6)
                      .map((a: any) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => linkAcct.mutate(a.id)}
                          disabled={linkAcct.isPending}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left disabled:opacity-50"
                          data-testid={`option-link-account-${a.id}`}
                        >
                          <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{a.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Leads */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Leads</span>
                </div>
                {/* Linked leads list */}
                <div className="space-y-1">
                  {(linkedLeads as any[]).map((l: any) => (
                    <div key={l.leadId} className="flex items-center justify-between py-1 px-2 rounded bg-muted/40 text-xs" data-testid={`linked-lead-${l.leadId}`}>
                      <span className="font-medium truncate">{l.leadName || l.company || `Lead #${l.leadId}`}</span>
                      {l.company && l.leadName && <span className="text-muted-foreground ml-1 shrink-0">{l.company}</span>}
                      <button
                        type="button"
                        onClick={() => unlinkLead.mutate(l.leadId)}
                        disabled={unlinkLead.isPending}
                        className="ml-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        data-testid={`button-unlink-lead-${l.leadId}`}
                        title="Remove link"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {(linkedLeads as any[]).length === 0 && (
                    <p className="text-xs text-muted-foreground pl-1">No leads linked yet.</p>
                  )}
                </div>
                {/* Lead search */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={leadSearch}
                    onChange={e => setLeadSearch(e.target.value)}
                    placeholder="Search to link a lead…"
                    className="h-7 text-xs pl-7"
                    data-testid="input-link-lead-search"
                  />
                </div>
                {leadSearch.trim().length > 0 && leadResults.length > 0 && (
                  <div className="border border-border rounded-md max-h-36 overflow-y-auto divide-y divide-border/50">
                    {leadResults
                      .filter((l: any) => !linkedLeadIds.has(l.id))
                      .slice(0, 6)
                      .map((l: any) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => linkLead.mutate(l.id)}
                          disabled={linkLead.isPending}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left disabled:opacity-50"
                          data-testid={`option-link-lead-${l.id}`}
                        >
                          <Plus className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">{l.contactName || l.company || `Lead #${l.id}`}</span>
                          {l.company && l.contactName && <span className="text-muted-foreground ml-1 shrink-0 text-[10px]">{l.company}</span>}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
              data-testid="button-edit-contact-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-edit-contact-save"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" /> Save changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
