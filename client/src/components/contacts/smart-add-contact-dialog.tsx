import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, UserPlus, Building2, X, CheckCircle2 } from "lucide-react";

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

interface SmartAddContactDialogProps {
  open: boolean;
  onClose: () => void;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  onSaved?: () => void;
}

export function SmartAddContactDialog({
  open,
  onClose,
  fromName,
  fromEmail,
  subject,
  body,
  onSaved,
}: SmartAddContactDialogProps) {
  const { toast } = useToast();
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [orgSearch, setOrgSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<{ id: number; name: string } | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgMode, setOrgMode] = useState<"pick" | "new" | "skip">("pick");

  const { data: orgResults = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/accounts", "smart-contact-search", orgSearch],
    queryFn: async () => {
      if (orgSearch.length < 2) return [];
      const res = await fetch(`/api/accounts?search=${encodeURIComponent(orgSearch)}&limit=8`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.accounts || data || []).slice(0, 8).map((a: any) => ({ id: a.id, name: a.name }));
    },
    enabled: orgSearch.length >= 2 && orgMode === "pick" && !selectedOrg,
  });

  useEffect(() => {
    if (!open) return;
    setName(fromName || "");
    setEmail(fromEmail || "");
    setTitle("");
    setPhone("");
    setLinkedinUrl("");
    setNotes("");
    setOrgSearch("");
    setSelectedOrg(null);
    setNewOrgName("");
    setOrgMode("pick");
    setExtractError(null);
    setExtracting(true);

    (async () => {
      try {
        const res = await apiRequest("POST", "/api/contacts/extract-from-email", {
          subject,
          fromName,
          fromEmail,
          body,
        });
        if (!res.ok) throw new Error((await res.json()).message || "Extraction failed");
        const { extracted }: { extracted: ExtractedContact } = await res.json();

        if (extracted.name) setName(extracted.name);
        else if (fromName) setName(fromName);
        if (extracted.title) setTitle(extracted.title);
        if (extracted.email) setEmail(extracted.email);
        else if (fromEmail) setEmail(fromEmail);
        if (extracted.phone) setPhone(extracted.phone);
        if (extracted.linkedinUrl) setLinkedinUrl(extracted.linkedinUrl);
        if (extracted.notes) setNotes(extracted.notes);
        if (extracted.company) {
          setOrgSearch(extracted.company);
          setNewOrgName(extracted.company);
        }
      } catch (e: any) {
        setExtractError(e.message || "Could not extract contact info — fields prefilled from email headers.");
        if (fromName) setName(fromName);
        if (fromEmail) setEmail(fromEmail);
      } finally {
        setExtracting(false);
      }
    })();
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let accountId: number | undefined = selectedOrg?.id;

      if (!accountId && orgMode === "new" && newOrgName.trim()) {
        const orgRes = await apiRequest("POST", "/api/accounts", {
          name: newOrgName.trim(),
          type: "marina",
        });
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
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact saved", description: `${name} has been added to your contacts.` });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save contact", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md z-[300]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Smart Add Contact
          </DialogTitle>
        </DialogHeader>

        {extracting ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm">Scanning email and signature for contact info…</p>
            <p className="text-xs text-muted-foreground/50">This usually takes a few seconds.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {extractError && (
              <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
                {extractError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">
                  Full name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name"
                  className="h-8"
                  data-testid="input-smart-contact-name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Job title</Label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Dock Master"
                  className="h-8"
                  data-testid="input-smart-contact-title"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="h-8"
                  data-testid="input-smart-contact-email"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="h-8"
                  data-testid="input-smart-contact-phone"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">LinkedIn</Label>
                <Input
                  value={linkedinUrl}
                  onChange={e => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/…"
                  className="h-8"
                  data-testid="input-smart-contact-linkedin"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <Building2 className="h-3 w-3" /> Organization
                </Label>
                <div className="flex gap-1">
                  {(["pick", "new", "skip"] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setOrgMode(m); setSelectedOrg(null); }}
                      className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                        orgMode === m
                          ? "bg-primary/15 border-primary/30 text-primary"
                          : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                      data-testid={`button-org-mode-${m}`}
                    >
                      {m === "pick" ? "Search" : m === "new" ? "Create new" : "Skip"}
                    </button>
                  ))}
                </div>
              </div>

              {orgMode === "pick" && (
                <div>
                  <Input
                    value={selectedOrg ? selectedOrg.name : orgSearch}
                    onChange={e => { setOrgSearch(e.target.value); setSelectedOrg(null); }}
                    placeholder="Search marina or account…"
                    className="h-8 text-sm"
                    readOnly={!!selectedOrg}
                    data-testid="input-smart-contact-org-search"
                  />
                  {selectedOrg && (
                    <div className="flex items-center gap-1 mt-1.5 px-2 py-1.5 rounded bg-primary/10 border border-primary/20 text-xs text-primary">
                      <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                      <span className="flex-1 truncate">{selectedOrg.name}</span>
                      <button
                        type="button"
                        onClick={() => { setSelectedOrg(null); setOrgSearch(""); }}
                        data-testid="button-clear-org"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {!selectedOrg && orgResults.length > 0 && (
                    <div className="mt-1 border border-border/40 rounded bg-popover shadow-md max-h-40 overflow-y-auto">
                      {orgResults.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                          onClick={() => { setSelectedOrg(a); setOrgSearch(a.name); }}
                          data-testid={`org-option-${a.id}`}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {orgMode === "new" && (
                <Input
                  value={newOrgName}
                  onChange={e => setNewOrgName(e.target.value)}
                  placeholder="New organization name"
                  className="h-8 text-sm"
                  data-testid="input-smart-contact-new-org"
                />
              )}

              {orgMode === "skip" && (
                <p className="text-[11px] text-muted-foreground/60 italic px-1">
                  Contact will be saved without an organization link.
                </p>
              )}
            </div>

            {notes && (
              <>
                <Separator />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Notes (extracted from signature)</Label>
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 border border-border/30">
                    {notes}
                  </p>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                data-testid="button-smart-contact-cancel"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!name.trim() || saveMutation.isPending}
                data-testid="button-smart-contact-save"
              >
                {saveMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
                Save Contact
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
