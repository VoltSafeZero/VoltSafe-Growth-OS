import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, UserPlus, Building2, X, CheckCircle2,
  UserCheck, AlertTriangle, ArrowRight, Check, RotateCcw, TextSelect, Anchor,
} from "lucide-react";

interface ExtractedContact {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

interface ExistingContact {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  accountId: number | null;
}

type Phase = "loading" | "create" | "exists" | "update-preview" | "saving";
type FieldDecision = "keep" | "use_new";

interface FieldCompare {
  key: keyof ExtractedContact;
  label: string;
  existing: string | null;
  extracted: string | null;
  status: "same" | "new" | "conflict";
  decision: FieldDecision;
}

const COMPARE_FIELDS: { key: keyof ExtractedContact; label: string }[] = [
  { key: "name",       label: "Full name" },
  { key: "title",      label: "Job title" },
  { key: "phone",      label: "Phone" },
  { key: "linkedinUrl",label: "LinkedIn" },
  { key: "notes",      label: "Notes" },
];

function normalize(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function buildComparison(existing: ExistingContact, extracted: ExtractedContact): FieldCompare[] {
  return COMPARE_FIELDS.map(({ key, label }) => {
    const ex = normalize((existing as any)[key]);
    const ai = normalize((extracted as any)[key]);
    const status: FieldCompare["status"] =
      !ai               ? "same"     :
      !ex               ? "new"      :
      ai === ex         ? "same"     :
                          "conflict";
    return {
      key, label,
      existing: (existing as any)[key] ?? null,
      extracted: (extracted as any)[key] ?? null,
      status,
      decision: status === "new" ? "use_new" : "keep",
    };
  });
}

interface SmartAddContactDialogProps {
  open: boolean;
  onClose: () => void;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  /** When non-empty, only this highlighted snippet is sent to the extractor. */
  selectedText?: string;
  onSaved?: () => void;
}

export function SmartAddContactDialog({
  open,
  onClose,
  fromName,
  fromEmail,
  subject,
  body,
  selectedText = "",
  onSaved,
}: SmartAddContactDialogProps) {
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("loading");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [existingContact, setExistingContact] = useState<ExistingContact | null>(null);
  const [extracted, setExtracted] = useState<ExtractedContact | null>(null);
  const [fieldComps, setFieldComps] = useState<FieldCompare[]>([]);
  const [activeSelectionMode, setActiveSelectionMode] = useState(false);

  // ── Create-mode state ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<{ id: number; name: string; type: "account" | "lead" } | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgMode, setOrgMode] = useState<"pick" | "new" | "skip">("pick");

  const { data: accountResults = [] } = useQuery<{ id: number; name: string; type: "account" }[]>({
    queryKey: ["/api/accounts", "smart-contact-search", orgSearch],
    queryFn: async () => {
      if (orgSearch.length < 2) return [];
      const res = await fetch(`/api/accounts?search=${encodeURIComponent(orgSearch)}&limit=8`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || data.accounts || data || []).slice(0, 8).map((a: any) => ({ id: a.id, name: a.name, type: "account" as const }));
    },
    enabled: orgSearch.length >= 2 && orgMode === "pick" && !selectedOrg,
  });

  const { data: leadSearchResults = [] } = useQuery<{ id: number; name: string; type: "lead"; city?: string }[]>({
    queryKey: ["/api/leads", "smart-contact-search", orgSearch],
    queryFn: async () => {
      if (orgSearch.length < 2) return [];
      const res = await fetch(`/api/leads?search=${encodeURIComponent(orgSearch)}&limit=8`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || data || []).slice(0, 8).map((l: any) => ({ id: l.id, name: l.company, type: "lead" as const, city: l.city }));
    },
    enabled: orgSearch.length >= 2 && orgMode === "pick" && !selectedOrg,
  });

  const orgResults: { id: number; name: string; type: "account" | "lead"; city?: string }[] = [
    ...accountResults,
    ...leadSearchResults,
  ];

  // ── Reset & load on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setPhase("loading");
    setExtractError(null);
    setExistingContact(null);
    setExtracted(null);
    setFieldComps([]);
    setName(fromName || "");
    setEmail(fromEmail || "");
    setTitle(""); setPhone(""); setLinkedinUrl(""); setNotes("");
    setOrgSearch(""); setSelectedOrg(null); setNewOrgName(""); setOrgMode("pick");

    // Snapshot whether we're in selection mode for this open cycle so the
    // render section can read it even after the async block finishes.
    const isSelectionMode = selectedText.length > 0;
    setActiveSelectionMode(isSelectionMode);

    (async () => {
      try {
        const extractPayload = isSelectionMode
          ? { body: selectedText, selectionMode: true }
          : { subject, fromName, fromEmail, body };

        const [extractRes, searchRes] = await Promise.all([
          apiRequest("POST", "/api/contacts/extract-from-email", extractPayload),
          fetch(`/api/contacts?search=${encodeURIComponent(fromEmail)}`, { credentials: "include" }),
        ]);

        let ext: ExtractedContact = { name: null, firstName: null, lastName: null, title: null, email: null, phone: null, company: null, address: null, linkedinUrl: null, notes: null };
        if (extractRes.ok) {
          const { extracted: e } = await extractRes.json();
          ext = e;
        } else {
          setExtractError("Could not extract contact info — fields prefilled from email headers.");
        }
        if (!ext.email && fromEmail) ext.email = fromEmail;
        if (!ext.name && fromName) ext.name = fromName;
        setExtracted(ext);

        // Check for existing contact by exact email match
        let existingMatch: ExistingContact | null = null;
        if (searchRes.ok) {
          const contacts: any[] = await searchRes.json();
          existingMatch = contacts.find(
            (c) => normalize(c.email) === normalize(fromEmail)
          ) ?? null;
        }

        if (existingMatch) {
          setExistingContact(existingMatch);
          setPhase("exists");
        } else {
          // Pre-fill create form from extracted data
          if (ext.name) setName(ext.name);
          if (ext.title) setTitle(ext.title);
          if (ext.email) setEmail(ext.email);
          if (ext.phone) setPhone(ext.phone);
          if (ext.linkedinUrl) setLinkedinUrl(ext.linkedinUrl);
          if (ext.notes) setNotes(ext.notes);
          if (ext.company) { setOrgSearch(ext.company); setNewOrgName(ext.company); }
          setPhase("create");
        }
      } catch (e: any) {
        setExtractError(e.message || "Failed to load — fields prefilled from email headers.");
        setName(fromName || ""); setEmail(fromEmail || "");
        setPhase("create");
      }
    })();
  }, [open]);

  // ── Enter update-preview mode ─────────────────────────────────────────────
  function startUpdate() {
    if (!existingContact || !extracted) return;
    const comps = buildComparison(existingContact, extracted);
    setFieldComps(comps);
    setPhase("update-preview");
  }

  function toggleDecision(key: keyof ExtractedContact) {
    setFieldComps(prev => prev.map(f =>
      f.key === key ? { ...f, decision: f.decision === "keep" ? "use_new" : "keep" } : f
    ));
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const isLeadPick = selectedOrg?.type === "lead";
      let accountId: number | undefined = isLeadPick ? undefined : selectedOrg?.id;
      if (!accountId && orgMode === "new" && newOrgName.trim()) {
        const orgRes = await apiRequest("POST", "/api/accounts", { name: newOrgName.trim(), type: "marina" });
        if (!orgRes.ok) throw new Error("Failed to create organization");
        const orgData = await orgRes.json();
        accountId = orgData.id;
      }
      const res = await apiRequest("POST", "/api/contacts", {
        name: name.trim(),
        title: title.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        linkedinUrl: linkedinUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        accountId,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to save contact");
      const created = await res.json();
      // Link to lead via lead_contacts if user picked a lead
      if (isLeadPick && selectedOrg && created?.id) {
        await apiRequest("POST", `/api/leads/${selectedOrg.id}/contacts`, { contactId: created.id });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact saved", description: `${name} has been added to your contacts.` });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => toast({ title: "Couldn't save contact", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!existingContact) throw new Error("No contact selected");
      const updates: Record<string, string | null> = {};
      for (const f of fieldComps) {
        if (f.status === "new" || (f.status === "conflict" && f.decision === "use_new")) {
          updates[f.key === "linkedinUrl" ? "linkedinUrl" : f.key] = f.extracted;
        }
      }
      if (Object.keys(updates).length === 0) return { noChanges: true };
      const res = await apiRequest("PUT", `/api/contacts/${existingContact.id}`, updates);
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update contact");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (data?.noChanges) {
        toast({ title: "No changes to apply", description: "The extracted info matches what's already on file." });
      } else {
        toast({ title: "Contact updated", description: `${existingContact?.name}'s information has been updated.` });
      }
      onSaved?.();
      onClose();
    },
    onError: (err: any) => toast({ title: "Couldn't update contact", description: err.message, variant: "destructive" }),
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md z-[300]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
            <span>
              {phase === "exists"         ? "Contact Already Exists"   :
               phase === "update-preview" ? `Update ${existingContact?.name?.split(" ")[0]}'s Info` :
                                            "Smart Add Contact"}
            </span>
            {activeSelectionMode && (
              <span
                data-testid="badge-selection-mode"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 border border-primary/30 text-primary"
              >
                <TextSelect className="h-2.5 w-2.5" />
                From selection
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── Loading ── */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            {activeSelectionMode ? (
              <>
                <p className="text-sm">Analyzing highlighted text…</p>
                <p className="text-xs text-muted-foreground/50">Extracting contact info from your selection.</p>
              </>
            ) : (
              <>
                <p className="text-sm">Scanning email and checking contact database…</p>
                <p className="text-xs text-muted-foreground/50">This usually takes a few seconds.</p>
              </>
            )}
          </div>
        )}

        {/* ── Contact exists screen ── */}
        {phase === "exists" && existingContact && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20">
              <UserCheck className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{existingContact.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{existingContact.email}</p>
                {existingContact.title && (
                  <p className="text-xs text-muted-foreground/70">{existingContact.title}</p>
                )}
              </div>
              <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 flex-shrink-0 self-start">
                In database
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              This contact is already in your CRM. Would you like to scan this email and update their information if anything has changed?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-exists-cancel">
                Cancel
              </Button>
              <Button size="sm" onClick={startUpdate} data-testid="button-update-contact-info">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Update Contact's Information
              </Button>
            </div>
          </div>
        )}

        {/* ── Update preview screen ── */}
        {phase === "update-preview" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Comparing email content with existing record. Review and confirm any changes below.
            </p>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {fieldComps.map((f) => (
                <div
                  key={f.key}
                  data-testid={`field-compare-${f.key}`}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    f.status === "same"     ? "border-border/20 bg-muted/10 opacity-50" :
                    f.status === "new"      ? "border-emerald-500/25 bg-emerald-500/5"  :
                    /* conflict */            "border-amber-500/25 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-foreground/70">{f.label}</span>
                    {f.status === "same" && (
                      <span className="text-[10px] text-muted-foreground/50">No change</span>
                    )}
                    {f.status === "new" && (
                      <span className="text-[10px] font-medium text-emerald-400 flex items-center gap-0.5">
                        <Check className="h-2.5 w-2.5" /> New info
                      </span>
                    )}
                    {f.status === "conflict" && (
                      <button
                        type="button"
                        data-testid={`toggle-field-${f.key}`}
                        onClick={() => toggleDecision(f.key)}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${
                          f.decision === "use_new"
                            ? "bg-primary/15 border-primary/30 text-primary"
                            : "bg-muted/30 border-border/40 text-muted-foreground"
                        }`}
                      >
                        {f.decision === "use_new" ? "Use new ✓" : "Keep existing"}
                      </button>
                    )}
                  </div>

                  {f.status === "same" && (
                    <p className="text-muted-foreground/60 truncate">{f.existing || "—"}</p>
                  )}
                  {f.status === "new" && (
                    <p className="text-emerald-400/90 truncate">{f.extracted}</p>
                  )}
                  {f.status === "conflict" && (
                    <div className="flex items-start gap-2 mt-0.5">
                      <div className={`flex-1 min-w-0 ${f.decision === "keep" ? "opacity-100" : "opacity-40 line-through"}`}>
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">Current</p>
                        <p className="text-foreground/70 truncate">{f.existing}</p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/30 flex-shrink-0 mt-3" />
                      <div className={`flex-1 min-w-0 ${f.decision === "use_new" ? "opacity-100" : "opacity-40"}`}>
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">From email</p>
                        <p className="text-amber-400/80 truncate">{f.extracted}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {fieldComps.every(f => f.status === "same") && (
                <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs justify-center">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400/60" />
                  All information already matches — nothing to update.
                </div>
              )}
            </div>

            {fieldComps.some(f => f.status === "conflict") && (
              <p className="text-[11px] text-amber-400/70 bg-amber-500/5 border border-amber-500/15 rounded px-2.5 py-1.5">
                <AlertTriangle className="h-3 w-3 inline-block mr-1" />
                Conflicting fields default to keeping existing data. Toggle to "Use new" to overwrite.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-update-cancel">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                data-testid="button-save-updates"
              >
                {updateMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Check className="h-3.5 w-3.5 mr-1.5" />}
                Save Updates
              </Button>
            </div>
          </div>
        )}

        {/* ── Create contact form ── */}
        {phase === "create" && (
          <div className="space-y-4">
            {extractError && (
              <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                {extractError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Full name <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className="h-8" data-testid="input-smart-contact-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Job title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Dock Master" className="h-8" data-testid="input-smart-contact-title" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className="h-8" data-testid="input-smart-contact-email" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" className="h-8" data-testid="input-smart-contact-phone" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">LinkedIn</Label>
                <Input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/…" className="h-8" data-testid="input-smart-contact-linkedin" />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> Account
                </Label>
                <div className="flex gap-1">
                  {(["pick", "new", "skip"] as const).map(m => (
                    <button key={m} type="button" onClick={() => { setOrgMode(m); setSelectedOrg(null); }}
                      className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${orgMode === m ? "bg-primary/15 border-primary/30 text-primary" : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"}`}
                      data-testid={`button-org-mode-${m}`}
                    >
                      {m === "pick" ? "Search" : m === "new" ? "Create new" : "Skip"}
                    </button>
                  ))}
                </div>
              </div>

              {orgMode === "pick" && (
                <div>
                  <Input value={selectedOrg ? selectedOrg.name : orgSearch} onChange={e => { setOrgSearch(e.target.value); setSelectedOrg(null); }} placeholder="Search marina or account…" className="h-8 text-sm" readOnly={!!selectedOrg} data-testid="input-smart-contact-org-search" />
                  {selectedOrg && (
                    <div className="flex items-center gap-1 mt-1.5 px-2 py-1.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary">
                      <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{selectedOrg.name}</span>
                      <button type="button" onClick={() => { setSelectedOrg(null); setOrgSearch(""); }} data-testid="button-clear-org"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                  {!selectedOrg && orgResults.length > 0 && (
                    <div className="mt-1 border border-border/40 rounded bg-popover shadow-md max-h-48 overflow-y-auto">
                      {accountResults.length > 0 && (
                        <>
                          <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/30 flex items-center gap-1">
                            <Building2 className="h-3 w-3" /> Accounts
                          </div>
                          {accountResults.map(a => (
                            <button key={`acct-${a.id}`} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2" onClick={() => { setSelectedOrg(a); setOrgSearch(a.name); }} data-testid={`org-option-${a.id}`}>
                              <Building2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{a.name}</span>
                            </button>
                          ))}
                        </>
                      )}
                      {leadSearchResults.length > 0 && (
                        <>
                          <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/30 border-t flex items-center gap-1">
                            <Anchor className="h-3 w-3" /> Leads
                          </div>
                          {leadSearchResults.map(l => (
                            <button key={`lead-${l.id}`} type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2" onClick={() => { setSelectedOrg(l); setOrgSearch(l.name); }} data-testid={`lead-option-${l.id}`}>
                              <Anchor className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{l.name}</span>
                              {l.city && <span className="ml-auto text-[10px] text-muted-foreground">{l.city}</span>}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {orgMode === "new" && (
                <Input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="New organization name" className="h-8 text-sm" data-testid="input-smart-contact-new-org" />
              )}

              {orgMode === "skip" && (
                <p className="text-[11px] text-muted-foreground/60 italic px-1">Contact will be saved without an organization link.</p>
              )}
            </div>

            {notes && (
              <>
                <Separator />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Notes (extracted from signature)</Label>
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 border border-border/30">{notes}</p>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-smart-contact-cancel">Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} data-testid="button-smart-contact-save">
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
                Save Contact
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
