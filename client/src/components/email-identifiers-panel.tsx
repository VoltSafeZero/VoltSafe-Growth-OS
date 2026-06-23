/**
 * EmailIdentifiersPanel
 *
 * Reusable component embedded in Account, Lead, and Contact detail views.
 * Allows users to pin authoritative email domains and specific email addresses
 * to a CRM entity so all matching emails auto-link to it.
 *
 * Features:
 * - Two chip lists: Verified Domains + Specific Emails
 * - Inline add input with real-time normalization preview
 * - Public domain rejection (gmail.com etc.) with clear message
 * - Conflict error showing which entity already owns the identifier
 * - Domain-coverage hint when adding an email whose domain is already pinned
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Globe, Mail, Plus, X, AlertCircle, Info, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrmEmailDomain {
  id: number;
  entity_type: string;
  entity_id: number;
  domain: string;
  label: string | null;
  is_verified: boolean;
  source: string;
  created_at: string;
}

interface CrmEmailAddress {
  id: number;
  entity_type: string;
  entity_id: number;
  email: string;
  label: string | null;
  is_verified: boolean;
  source: string;
  created_at: string;
}

// ── Public domain set (mirrored from shared/public-domains.ts for client-side preview) ─
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com","googlemail.com","yahoo.com","outlook.com","hotmail.com","live.com",
  "msn.com","icloud.com","me.com","mac.com","aol.com","proton.me","protonmail.com",
  "zoho.com","mail.com","gmx.com","yandex.com","comcast.net","telus.net","shaw.ca",
  "rogers.com","bell.net","sympatico.ca","hey.com",
]);

function isPublicDomain(domain: string) {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase().trim());
}

type ParsedInput =
  | { type: "domain"; value: string }
  | { type: "email";  value: string }
  | { type: "invalid"; value: string; reason: string }
  | { type: "empty" };

function parseInput(raw: string): ParsedInput {
  const s = raw.trim();
  if (!s) return { type: "empty" };
  let v = s;
  if (v.toLowerCase().startsWith("mailto:")) v = v.slice(7).trim();
  if (v.includes("@")) {
    const norm = v.toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(norm)) return { type: "invalid", value: norm, reason: "Invalid email address format" };
    return { type: "email", value: norm };
  }
  v = v.replace(/^@/, "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  v = v.split("/")[0].split("?")[0].split("#")[0].split(":")[0].toLowerCase().trim();
  const domainRegex = /^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$/;
  if (!domainRegex.test(v)) return { type: "invalid", value: v, reason: "Invalid domain format" };
  return { type: "domain", value: v };
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  entityType: "lead" | "account" | "contact";
  entityId: number;
  canEdit: boolean;
}

export function EmailIdentifiersPanel({ entityType, entityId, canEdit }: Props) {
  const { toast } = useToast();
  const [domainInput, setDomainInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [showDomainAdd, setShowDomainAdd] = useState(false);
  const [showEmailAdd, setShowEmailAdd] = useState(false);

  const base = `/api/crm/${entityType}/${entityId}`;
  const queryKey = [base, "email-identifiers"];

  const { data, isLoading } = useQuery<{ domains: CrmEmailDomain[]; addresses: CrmEmailAddress[] }>({
    queryKey,
    queryFn: () => fetch(base + "/email-identifiers", { credentials: "include" }).then(r => r.json()),
  });

  const domains = data?.domains ?? [];
  const addresses = data?.addresses ?? [];

  // ── Mutations ───────────────────────────────────────────────────────────────

  const addDomain = useMutation({
    mutationFn: (domain: string) =>
      apiRequest("POST", `${base}/email-domains`, { domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDomainInput("");
      setShowDomainAdd(false);
    },
    onError: (err: any) => {
      toast({ title: "Cannot add domain", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const removeDomain = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `${base}/email-domains/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err: any) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  const addAddress = useMutation({
    mutationFn: (email: string) =>
      apiRequest("POST", `${base}/email-addresses`, { email }),
    onSuccess: (resp: any) => {
      queryClient.invalidateQueries({ queryKey });
      setEmailInput("");
      setShowEmailAdd(false);
      if (resp?.coveredByDomain) {
        toast({ title: "Email added", description: resp.coveredByDomainNote, variant: "default" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Cannot add email", description: err.message || "An error occurred", variant: "destructive" });
    },
  });

  const removeAddress = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `${base}/email-addresses/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err: any) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Domain input preview ────────────────────────────────────────────────────

  const domainParsed = parseInput(domainInput);
  const domainPreviewError =
    domainInput.trim() === "" ? null :
    domainParsed.type === "email" ? "That looks like a full email address — use 'Add specific email' instead." :
    domainParsed.type === "invalid" ? domainParsed.reason :
    domainParsed.type === "domain" && isPublicDomain(domainParsed.value)
      ? `Public domains (${domainParsed.value}) can't be domain identifiers. Add the full email address instead.`
      : null;

  const domainPreviewOk =
    domainParsed.type === "domain" && !isPublicDomain(domainParsed.value) ? domainParsed.value : null;

  // ── Email input preview ─────────────────────────────────────────────────────

  const emailParsed = parseInput(emailInput);
  const emailPreviewError =
    emailInput.trim() === "" ? null :
    emailParsed.type === "domain" ? "That looks like a domain — use 'Add domain' instead, or type a full email." :
    emailParsed.type === "invalid" ? emailParsed.reason :
    null;

  const emailPreviewOk = emailParsed.type === "email" ? emailParsed.value : null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleAddDomain() {
    if (!domainPreviewOk) return;
    addDomain.mutate(domainPreviewOk);
  }

  function handleAddEmail() {
    if (!emailPreviewOk) return;
    addAddress.mutate(emailPreviewOk);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card className="border-border/50" data-testid="email-identifiers-panel">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-primary" />
            Email Identifiers
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[260px] text-xs">
                Pinned domains and email addresses override fuzzy matching. Any email
                from a pinned domain or address is automatically linked to this record.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading identifiers…
          </div>
        )}

        {/* ── Verified Domains ─────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Globe className="h-3 w-3" /> Verified Domains
            </p>
            {canEdit && !showDomainAdd && (
              <Button
                variant="ghost" size="sm"
                className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowDomainAdd(true)}
                data-testid="button-add-domain"
              >
                <Plus className="h-3 w-3 mr-0.5" /> Add
              </Button>
            )}
          </div>

          {/* Domain chips */}
          <div className="flex flex-wrap gap-1.5" data-testid="domain-chips">
            {domains.length === 0 && !showDomainAdd && (
              <p className="text-xs text-muted-foreground/60 italic">No domain identifiers yet.</p>
            )}
            {domains.map((d) => (
              <Badge
                key={d.id}
                variant="secondary"
                className="gap-1 pl-2 pr-1 py-0.5 text-xs font-normal group"
                data-testid={`chip-domain-${d.id}`}
              >
                <Globe className="h-2.5 w-2.5 text-primary/70" />
                @{d.domain}
                {d.label && <span className="text-muted-foreground">· {d.label}</span>}
                {canEdit && (
                  <button
                    className="ml-0.5 opacity-50 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    onClick={() => removeDomain.mutate(d.id)}
                    disabled={removeDomain.isPending}
                    aria-label={`Remove ${d.domain}`}
                    data-testid={`button-remove-domain-${d.id}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            ))}
          </div>

          {/* Domain add input */}
          {canEdit && showDomainAdd && (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  placeholder="boatbnb.com or @boatbnb.com or https://…"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddDomain();
                    if (e.key === "Escape") { setShowDomainAdd(false); setDomainInput(""); }
                  }}
                  className="h-7 text-xs"
                  data-testid="input-add-domain"
                />
                <Button
                  size="sm" className="h-7 text-xs px-2"
                  onClick={handleAddDomain}
                  disabled={!domainPreviewOk || addDomain.isPending}
                  data-testid="button-confirm-add-domain"
                >
                  {addDomain.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs px-2"
                  onClick={() => { setShowDomainAdd(false); setDomainInput(""); }}
                >
                  Cancel
                </Button>
              </div>
              {domainPreviewOk && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <Globe className="h-3 w-3" /> Will add: <span className="font-mono">@{domainPreviewOk}</span>
                </p>
              )}
              {domainPreviewError && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="domain-error">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {domainPreviewError}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border/30" />

        {/* ── Specific Emails ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" /> Specific Emails
            </p>
            {canEdit && !showEmailAdd && (
              <Button
                variant="ghost" size="sm"
                className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowEmailAdd(true)}
                data-testid="button-add-email"
              >
                <Plus className="h-3 w-3 mr-0.5" /> Add
              </Button>
            )}
          </div>

          {/* Email chips */}
          <div className="flex flex-wrap gap-1.5" data-testid="email-chips">
            {addresses.length === 0 && !showEmailAdd && (
              <p className="text-xs text-muted-foreground/60 italic">No specific emails yet.</p>
            )}
            {addresses.map((a) => (
              <Badge
                key={a.id}
                variant="secondary"
                className="gap-1 pl-2 pr-1 py-0.5 text-xs font-normal group"
                data-testid={`chip-email-${a.id}`}
              >
                <Mail className="h-2.5 w-2.5 text-primary/70" />
                {a.email}
                {a.label && <span className="text-muted-foreground">· {a.label}</span>}
                {canEdit && (
                  <button
                    className="ml-0.5 opacity-50 group-hover:opacity-100 hover:text-destructive transition-opacity"
                    onClick={() => removeAddress.mutate(a.id)}
                    disabled={removeAddress.isPending}
                    aria-label={`Remove ${a.email}`}
                    data-testid={`button-remove-email-${a.id}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            ))}
          </div>

          {/* Email add input */}
          {canEdit && showEmailAdd && (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  placeholder="boatbnbsd@gmail.com or info@boatbnb.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddEmail();
                    if (e.key === "Escape") { setShowEmailAdd(false); setEmailInput(""); }
                  }}
                  className="h-7 text-xs"
                  data-testid="input-add-email"
                />
                <Button
                  size="sm" className="h-7 text-xs px-2"
                  onClick={handleAddEmail}
                  disabled={!emailPreviewOk || addAddress.isPending}
                  data-testid="button-confirm-add-email"
                >
                  {addAddress.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs px-2"
                  onClick={() => { setShowEmailAdd(false); setEmailInput(""); }}
                >
                  Cancel
                </Button>
              </div>
              {emailPreviewOk && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Will add: <span className="font-mono">{emailPreviewOk}</span>
                </p>
              )}
              {emailPreviewError && (
                <p className="text-xs text-destructive flex items-center gap-1" data-testid="email-error">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {emailPreviewError}
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
