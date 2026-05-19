import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Building2, Mail, Phone, User, ExternalLink,
  CheckCircle2, Sparkles, AlertTriangle, Link2,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function orgNameFromDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return main.charAt(0).toUpperCase() + main.slice(1);
}

export const KNOWN_PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "live.com", "msn.com", "aol.com", "protonmail.com",
  "yahoo.co.uk", "yahoo.ca", "yahoo.com.au", "hotmail.co.uk",
  "googlemail.com", "outlook.co.uk", "live.co.uk",
]);

export function isPersonalDomain(domain: string): boolean {
  return KNOWN_PERSONAL_DOMAINS.has(domain.toLowerCase());
}

export const RELATIONSHIP_TYPES = [
  { value: "Marina",           label: "Marina" },
  { value: "Partner",          label: "Partner" },
  { value: "Dealer",           label: "Dealer / Distributor" },
  { value: "Investor",         label: "Investor" },
  { value: "Media / Press",    label: "Media / Press" },
  { value: "Government",       label: "Government / Regulatory" },
  { value: "Prospect",         label: "Prospect (General)" },
  { value: "Other",            label: "Other" },
];

/* ── types ───────────────────────────────────────────────────────────────── */

export interface ExistingCrm {
  lead?:    { id: number; company: string; status?: string } | null;
  contact?: { id: number; name: string }  | null;
  account?: { id: number; name: string }  | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  fromName: string;
  fromEmail: string;
  subject?: string;
  /** Pass thread's existing CRM associations so the dialog can warn before creating a duplicate. */
  existingCrm?: ExistingCrm;
}

/* ── component ───────────────────────────────────────────────────────────── */

export function NewLeadFromEmailDialog({
  open, onClose, fromName, fromEmail, subject, existingCrm,
}: Props) {
  const { toast } = useToast();

  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  const suggestedCompany = domain && !isPersonalDomain(domain) ? orgNameFromDomain(domain) : "";

  const [contactName,      setContactName]      = useState(fromName);
  const [contactEmail,     setContactEmail]      = useState(fromEmail);
  const [company,          setCompany]          = useState(suggestedCompany);
  const [contactPhone,     setContactPhone]      = useState("");
  const [relationshipType, setRelationshipType] = useState("Marina");
  const [notes,            setNotes]            = useState(subject ? `Initial email subject: "${subject}"` : "");
  const [confirmed,        setConfirmed]        = useState(false);

  const [createdLead, setCreatedLead] = useState<{ id: number; company: string } | null>(null);

  /* Derived: does this thread already have CRM links? */
  const hasCrmLinks = !!(existingCrm?.lead || existingCrm?.contact || existingCrm?.account);

  /* Reset whenever the dialog opens for a new email */
  useEffect(() => {
    if (open) {
      const d = fromEmail.split("@")[1]?.toLowerCase() ?? "";
      const co = d && !isPersonalDomain(d) ? orgNameFromDomain(d) : "";
      setContactName(fromName);
      setContactEmail(fromEmail);
      setCompany(co);
      setContactPhone("");
      setRelationshipType("Marina");
      setNotes(subject ? `Initial email subject: "${subject}"` : "");
      setCreatedLead(null);
      setConfirmed(false);
    }
  }, [open, fromName, fromEmail, subject]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company:          company.trim() || contactEmail.split("@")[0],
        contactName:      contactName.trim(),
        contactEmail:     contactEmail.trim(),
        contactPhone:     contactPhone.trim() || undefined,
        relationshipType,
        notes:            notes.trim() || undefined,
        source:           "inbound_email",
        status:           "new",
      };
      return apiRequest("POST", "/api/leads", payload).then((r) => r.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setCreatedLead({ id: data.id, company: data.company });
      toast({ title: "Lead created", description: `${data.company} added to CRM` });
    },
    onError: () => {
      toast({ title: "Failed to create lead", variant: "destructive" });
    },
  });

  /* Button is unlocked when:
     - required fields filled AND
     - either no existing CRM links, OR user explicitly confirmed they want a duplicate */
  const canSubmit =
    company.trim().length > 0 &&
    contactName.trim().length > 0 &&
    (!hasCrmLinks || confirmed);

  function handleClose() {
    setCreatedLead(null);
    onClose();
  }

  /* ── render ── */
  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="max-w-lg w-[96vw] p-0 overflow-hidden"
        data-testid="new-lead-from-email-dialog"
      >
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-semibold">New Lead from Email</DialogTitle>
              <p className="text-[11.5px] text-muted-foreground/60 mt-0.5">
                Pre-filled from sender — review and save to CRM
              </p>
            </div>
          </div>
        </DialogHeader>

        {createdLead ? (
          /* ── Success state ── */
          <div className="px-5 py-8 flex flex-col items-center text-center gap-4">
            <div className="h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-foreground">{createdLead.company} added</p>
              <p className="text-[12.5px] text-muted-foreground/60 mt-1">Lead created successfully in CRM</p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <a href={`/leads/${createdLead.id}`} target="_blank" rel="noreferrer" data-testid="link-open-created-lead">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Lead
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClose} data-testid="button-new-lead-close-success">
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <div className="px-5 py-4 space-y-4">

            {/* ── Existing CRM warning (check 7 & 8) ── */}
            {hasCrmLinks && (
              <div
                className="rounded-md bg-yellow-500/8 border border-yellow-500/30 px-3 py-2.5 space-y-2"
                data-testid="existing-crm-warning"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-400/80 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-yellow-400/90 leading-relaxed font-medium">
                    This email thread is already linked to CRM records:
                  </p>
                </div>
                <ul className="ml-5 space-y-0.5">
                  {existingCrm?.lead && (
                    <li className="flex items-center gap-1.5 text-[10.5px] text-yellow-400/70">
                      <Link2 className="h-2.5 w-2.5 flex-shrink-0" />
                      Lead: <a href={`/leads/${existingCrm.lead.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-yellow-300 transition-colors" data-testid="link-existing-lead">{existingCrm.lead.company}</a>
                      {existingCrm.lead.status && <span className="text-yellow-400/40">({existingCrm.lead.status})</span>}
                    </li>
                  )}
                  {existingCrm?.contact && (
                    <li className="flex items-center gap-1.5 text-[10.5px] text-yellow-400/70">
                      <Link2 className="h-2.5 w-2.5 flex-shrink-0" />
                      Contact: <a href={`/contacts/${existingCrm.contact.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-yellow-300 transition-colors" data-testid="link-existing-contact">{existingCrm.contact.name}</a>
                    </li>
                  )}
                  {existingCrm?.account && (
                    <li className="flex items-center gap-1.5 text-[10.5px] text-yellow-400/70">
                      <Link2 className="h-2.5 w-2.5 flex-shrink-0" />
                      Account: <a href={`/accounts/${existingCrm.account.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-yellow-300 transition-colors" data-testid="link-existing-account">{existingCrm.account.name}</a>
                    </li>
                  )}
                </ul>
                <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5" data-testid="label-confirm-duplicate">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-amber-500"
                    data-testid="checkbox-confirm-duplicate"
                  />
                  <span className="text-[10.5px] text-yellow-400/80">
                    I understand — create a new lead anyway
                  </span>
                </label>
              </div>
            )}

            {/* ── Smart prefill notice ── */}
            {!hasCrmLinks && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/8 border border-amber-500/20 px-3 py-2" data-testid="prefill-notice">
                <Sparkles className="h-3.5 w-3.5 text-amber-400/80 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/80 leading-relaxed">
                  Pre-filled from <span className="font-medium">{fromEmail}</span>.
                  {suggestedCompany && <> Company guessed from <span className="font-mono">{domain}</span>.</>}
                  {" "}Edit before saving.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Contact Name */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                  <User className="inline h-3 w-3 mr-1 opacity-50" />Contact Name
                </Label>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Full name"
                  className="h-9 text-sm"
                  data-testid="input-new-lead-contact-name"
                />
              </div>

              {/* Company */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                  <Building2 className="inline h-3 w-3 mr-1 opacity-50" />Company / Marina
                  <Badge variant="outline" className="ml-1.5 text-[8.5px] px-1 py-0 text-amber-400/70 border-amber-500/30">required</Badge>
                </Label>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Marina or company name"
                  className="h-9 text-sm"
                  data-testid="input-new-lead-company"
                />
              </div>

              {/* Email */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                  <Mail className="inline h-3 w-3 mr-1 opacity-50" />Email
                </Label>
                <Input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contact@marina.com"
                  type="email"
                  className="h-9 text-sm"
                  data-testid="input-new-lead-email"
                />
              </div>

              {/* Phone */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                  <Phone className="inline h-3 w-3 mr-1 opacity-50" />Phone
                </Label>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  type="tel"
                  className="h-9 text-sm"
                  data-testid="input-new-lead-phone"
                />
              </div>
            </div>

            {/* Relationship type */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                Lead Type
              </Label>
              <Select value={relationshipType} onValueChange={setRelationshipType}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-new-lead-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/55 mb-1 block">
                Notes
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any initial context about this lead…"
                className="text-sm resize-none"
                rows={3}
                data-testid="input-new-lead-notes"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-1">
              <div className="text-[10px] text-muted-foreground/40" data-testid="new-lead-source-status-label">
                Source: <span className="font-mono">inbound_email</span> · Status: <span className="font-mono">new</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClose}
                  disabled={mutation.isPending}
                  className="h-8"
                  data-testid="button-new-lead-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => mutation.mutate()}
                  disabled={!canSubmit || mutation.isPending}
                  className="h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-medium disabled:opacity-50"
                  data-testid="button-new-lead-create"
                >
                  {mutation.isPending ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                      Creating…
                    </span>
                  ) : (
                    <>
                      <Building2 className="h-3.5 w-3.5" />
                      {hasCrmLinks && !confirmed ? "Confirm above to continue" : "Create Lead"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
