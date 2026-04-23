import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Camera, Upload, Link2, Sparkles, Loader2, RotateCcw, ImagePlus, Building2, ChevronsUpDown, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type ExtractedContact = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  company?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
};

export function CreateContactDialog({
  open,
  onOpenChange,
  accountId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number | null;
  onCreated: (contact: any) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"manual" | "card" | "url">("manual");

  // Form fields (shared across modes — populated by extraction or typed)
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");

  // Card scan state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [cardPreview, setCardPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // URL extract state
  const [url, setUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const [saving, setSaving] = useState(false);

  // Organization picker (only shown when no accountId was injected by the caller)
  const [pickedAccountId, setPickedAccountId] = useState<number | null>(accountId);
  const [pickedAccountName, setPickedAccountName] = useState<string>("");
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [orgSearch, setOrgSearch] = useState("");

  const { data: orgResults } = useQuery<any>({
    queryKey: ["/api/accounts", { search: orgSearch }],
    queryFn: async () => {
      const r = await fetch(`/api/accounts?search=${encodeURIComponent(orgSearch)}&limit=20`, { credentials: "include" });
      if (!r.ok) return { data: [] };
      return r.json();
    },
    enabled: open && !accountId && orgPickerOpen,
  });
  const orgList: any[] = useMemo(() => orgResults?.data || orgResults || [], [orgResults]);

  // Reset everything when the dialog closes
  useEffect(() => {
    if (!open) {
      setMode("manual");
      setName(""); setTitle(""); setEmail(""); setPhone(""); setLinkedinUrl(""); setNotes("");
      setCardPreview(null); setScanning(false);
      setUrl(""); setFetchingUrl(false);
      setSaving(false);
      setPickedAccountId(accountId);
      setPickedAccountName("");
      setOrgSearch("");
    } else {
      setPickedAccountId(accountId);
    }
  }, [open, accountId]);

  const effectiveAccountId = accountId ?? pickedAccountId;

  const applyExtracted = (e: ExtractedContact) => {
    const fullName =
      e.name?.trim() ||
      [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
    if (fullName) setName(fullName);
    if (e.title) setTitle(e.title);
    if (e.email) setEmail(e.email);
    if (e.phone) setPhone(e.phone);
    if (e.linkedinUrl) setLinkedinUrl(e.linkedinUrl);
    const noteParts: string[] = [];
    if (e.company) noteParts.push(`Company: ${e.company}`);
    if (e.website) noteParts.push(`Website: ${e.website}`);
    if (e.address) noteParts.push(`Address: ${e.address}`);
    if (e.notes) noteParts.push(e.notes);
    if (noteParts.length) setNotes(noteParts.join("\n"));
  };

  const handleCardFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setCardPreview(URL.createObjectURL(file));
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/contacts/extract-from-image", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.message || "Couldn't read the card");
      }
      const { extracted } = await res.json();
      applyExtracted(extracted || {});
      toast({ title: "Card scanned", description: "Review the details below before saving." });
    } catch (e: any) {
      toast({ title: "Card scan failed", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleUrlFetch = async () => {
    if (!url.trim()) return;
    setFetchingUrl(true);
    try {
      const res = await apiRequest("POST", "/api/contacts/extract-from-url", { url: url.trim() });
      const data = await res.json();
      applyExtracted(data?.extracted || {});
      toast({ title: "Profile imported", description: "Review the details below before saving." });
    } catch (e: any) {
      toast({ title: "Couldn't read that link", description: e.message, variant: "destructive" });
    } finally {
      setFetchingUrl(false);
    }
  };

  const needsOrgPicker = !accountId;
  const canSave = name.trim().length > 0 && (!!effectiveAccountId || (needsOrgPicker && pickedAccountName.trim().length > 0)) && !saving;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let finalAccountId = effectiveAccountId;
      // If user typed a brand new org name (didn't pick one), create it on the fly
      if (!finalAccountId && needsOrgPicker && pickedAccountName.trim()) {
        const accRes = await apiRequest("POST", "/api/accounts", {
          name: pickedAccountName.trim(),
          segment: "marina",
          leadStatus: "new",
          priority: "medium",
        });
        const acc = await accRes.json();
        finalAccountId = acc.id;
      }
      if (!finalAccountId) {
        toast({ title: "Pick or name an organization", variant: "destructive" });
        setSaving(false);
        return;
      }
      const res = await apiRequest("POST", "/api/contacts", {
        accountId: finalAccountId,
        name: name.trim(),
        title: title.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedinUrl: linkedinUrl.trim() || null,
        notes: notes.trim() || null,
      });
      const created = await res.json();
      onCreated(created);
      onOpenChange(false);
      toast({ title: "Contact created", description: name.trim() });
    } catch (e: any) {
      toast({ title: "Couldn't save contact", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="dialog-create-contact">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> New contact
          </DialogTitle>
          <DialogDescription>
            Type it in, scan a business card, or paste a LinkedIn / website link.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="manual" data-testid="tab-mode-manual">Manual</TabsTrigger>
            <TabsTrigger value="card" data-testid="tab-mode-card">
              <Camera className="h-3.5 w-3.5 mr-1" /> Business card
            </TabsTrigger>
            <TabsTrigger value="url" data-testid="tab-mode-url">
              <Link2 className="h-3.5 w-3.5 mr-1" /> From link
            </TabsTrigger>
          </TabsList>

          {/* Card scan */}
          <TabsContent value="card" className="space-y-3 pt-3">
            {cardPreview ? (
              <div className="relative rounded-lg overflow-hidden border border-border/60 bg-secondary/20">
                <img src={cardPreview} alt="Business card" className="w-full max-h-56 object-contain" />
                {scanning && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> Reading card…
                    </div>
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 h-7 text-xs gap-1"
                  onClick={() => { setCardPreview(null); }}
                  data-testid="button-card-retake"
                >
                  <RotateCcw className="h-3 w-3" /> Retake
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 h-24 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition"
                  data-testid="button-card-camera"
                >
                  <Camera className="h-5 w-5 text-primary" />
                  <span className="text-xs font-medium">Take photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 h-24 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition"
                  data-testid="button-card-upload"
                >
                  <ImagePlus className="h-5 w-5 text-primary" />
                  <span className="text-xs font-medium">Upload from gallery</span>
                </button>
              </div>
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleCardFile(e.target.files?.[0])}
              data-testid="input-card-camera"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleCardFile(e.target.files?.[0])}
              data-testid="input-card-upload"
            />
            <p className="text-[11px] text-muted-foreground">
              Tip: place the card on a dark surface in good light. We'll auto-fill the form below — you can edit anything before saving.
            </p>
          </TabsContent>

          {/* URL extract */}
          <TabsContent value="url" className="space-y-3 pt-3">
            <div className="space-y-2">
              <Label htmlFor="contact-url" className="text-xs">LinkedIn or website URL</Label>
              <div className="flex gap-2">
                <Input
                  id="contact-url"
                  placeholder="https://www.linkedin.com/in/janesmith"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-testid="input-contact-url"
                />
                <Button
                  type="button"
                  onClick={handleUrlFetch}
                  disabled={!url.trim() || fetchingUrl}
                  className="gap-1.5"
                  data-testid="button-fetch-url"
                >
                  {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {fetchingUrl ? "Reading…" : "Import"}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Public sites work best. LinkedIn often blocks bots — if it fails, try a business card photo or paste the public profile text into Notes manually.
            </p>
          </TabsContent>

          <TabsContent value="manual" className="pt-3">
            <p className="text-xs text-muted-foreground">Fill in the fields below.</p>
          </TabsContent>
        </Tabs>

        {/* Shared form (always visible — pre-filled by card/url, or typed for manual) */}
        <div className="space-y-3 mt-3 border-t border-border/40 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="contact-name" className="text-xs">Full name *</Label>
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-contact-name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-title" className="text-xs">Job title</Label>
              <Input id="contact-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-contact-title" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-email" className="text-xs">Email</Label>
              <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-contact-email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-phone" className="text-xs">Phone</Label>
              <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-contact-phone" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="contact-linkedin" className="text-xs">LinkedIn URL</Label>
              <Input id="contact-linkedin" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} data-testid="input-contact-linkedin" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="contact-notes" className="text-xs">Notes</Label>
              <Textarea id="contact-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-contact-notes" />
            </div>
          </div>

          {needsOrgPicker && (
            <div className="space-y-1">
              <Label className="text-xs">Organization *</Label>
              <Popover open={orgPickerOpen} onOpenChange={setOrgPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                    data-testid="button-pick-org"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {pickedAccountName || (effectiveAccountId ? "Selected" : "Choose or type new…")}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search or type a new organization name…"
                      value={orgSearch}
                      onValueChange={setOrgSearch}
                      data-testid="input-org-search"
                    />
                    <CommandList>
                      <CommandEmpty>
                        <div className="py-2 text-xs text-muted-foreground">Type a name and tap "Create new"</div>
                      </CommandEmpty>
                      <CommandGroup heading="Existing">
                        {orgList.slice(0, 12).map((o: any) => (
                          <CommandItem
                            key={o.id}
                            value={String(o.id)}
                            onSelect={() => { setPickedAccountId(o.id); setPickedAccountName(o.name); setOrgPickerOpen(false); }}
                            data-testid={`option-org-${o.id}`}
                          >
                            <Building2 className="h-3 w-3 mr-2 text-muted-foreground" />
                            <span className="truncate">{o.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                      {orgSearch.trim() && (
                        <CommandGroup heading="Or">
                          <CommandItem
                            value={`__new__${orgSearch}`}
                            onSelect={() => { setPickedAccountId(null); setPickedAccountName(orgSearch.trim()); setOrgPickerOpen(false); }}
                            data-testid="option-org-create-new"
                          >
                            <Plus className="h-3 w-3 mr-2" /> Create new "{orgSearch.trim()}"
                          </CommandItem>
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-contact">Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={!canSave} className="gap-1.5" data-testid="button-save-contact">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Save contact
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
