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
import { Camera, Link2, Sparkles, Loader2, RotateCcw, ImagePlus, Building2, ChevronsUpDown, Plus, X } from "lucide-react";
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

type ContactMode = "manual" | "card" | "url";

type CardSide = "front" | "back";

type CardSlot = {
  file: File | null;
  preview: string | null;
};

const emptySlot: CardSlot = { file: null, preview: null };

export function CreateContactDialog({
  open,
  onOpenChange,
  accountId,
  onCreated,
  initialMode = "manual",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number | null;
  onCreated: (contact: any) => void;
  initialMode?: ContactMode;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<ContactMode>(initialMode);

  // Form fields (shared across modes — populated by extraction or typed)
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");

  // Card scan state — front and back of the card
  const frontCameraRef = useRef<HTMLInputElement>(null);
  const frontUploadRef = useRef<HTMLInputElement>(null);
  const backCameraRef = useRef<HTMLInputElement>(null);
  const backUploadRef = useRef<HTMLInputElement>(null);
  const [front, setFront] = useState<CardSlot>(emptySlot);
  const [back, setBack] = useState<CardSlot>(emptySlot);
  const [scanning, setScanning] = useState(false);

  // URL extract state
  const [url, setUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [autoFetched, setAutoFetched] = useState<string | null>(null);

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

  // Track the previous (open, initialMode) so we can detect a mode change
  // while the dialog is already open and treat it as a fresh "session".
  const prevOpenModeRef = useRef<{ open: boolean; initialMode: ContactMode }>({
    open: false,
    initialMode,
  });

  // Reset everything when (a) the dialog closes, (b) it just opened,
  // or (c) initialMode changed while the dialog was already open.
  useEffect(() => {
    const prev = prevOpenModeRef.current;
    const justClosed = !open;
    const justOpened = open && !prev.open;
    const modeSwitchedWhileOpen = open && prev.open && prev.initialMode !== initialMode;

    if (justClosed || justOpened || modeSwitchedWhileOpen) {
      setMode(initialMode);
      setName(""); setTitle(""); setEmail(""); setPhone(""); setLinkedinUrl(""); setNotes("");
      setFront((s) => { if (s.preview) URL.revokeObjectURL(s.preview); return emptySlot; });
      setBack((s) => { if (s.preview) URL.revokeObjectURL(s.preview); return emptySlot; });
      setScanning(false);
      setUrl(""); setFetchingUrl(false); setAutoFetched(null);
      setSaving(false);
      setPickedAccountId(accountId);
      setPickedAccountName("");
      setOrgSearch("");
    }

    prevOpenModeRef.current = { open, initialMode };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId, initialMode]);

  // Revoke any outstanding object URL if the component unmounts mid-flow.
  // (Per-preview cleanup effects: when front.preview / back.preview change
  // — including to null — the previous render's cleanup revokes the old URL.)
  useEffect(() => {
    return () => {
      if (front.preview) URL.revokeObjectURL(front.preview);
    };
  }, [front.preview]);
  useEffect(() => {
    return () => {
      if (back.preview) URL.revokeObjectURL(back.preview);
    };
  }, [back.preview]);

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
    // Pre-fill org name suggestion if we don't have one yet
    if (e.company && !pickedAccountName && !pickedAccountId && !accountId) {
      setPickedAccountName(e.company);
    }
  };

  const handleSidePicked = (side: CardSide, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    const preview = URL.createObjectURL(file);
    if (side === "front") {
      if (front.preview) URL.revokeObjectURL(front.preview);
      setFront({ file, preview });
    } else {
      if (back.preview) URL.revokeObjectURL(back.preview);
      setBack({ file, preview });
    }
  };

  const clearSide = (side: CardSide) => {
    if (side === "front") {
      if (front.preview) URL.revokeObjectURL(front.preview);
      setFront(emptySlot);
    } else {
      if (back.preview) URL.revokeObjectURL(back.preview);
      setBack(emptySlot);
    }
  };

  const handleScanCard = async () => {
    if (!front.file && !back.file) {
      toast({ title: "Add at least one photo of the card first" });
      return;
    }
    setScanning(true);
    try {
      const fd = new FormData();
      if (front.file) fd.append("front", front.file);
      if (back.file) fd.append("back", back.file);
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
      toast({
        title: "Card scanned",
        description: front.file && back.file
          ? "Combined info from front + back. Review the details below before saving."
          : "Review the details below before saving.",
      });
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
      if (data?.warning) {
        // The backend was only able to get partial data (typically because
        // LinkedIn blocked the scrape). Surface that loudly so the user
        // knows to fill in the rest manually.
        toast({
          title: "Partial import",
          description: data.warning,
          variant: "destructive",
        });
      } else {
        toast({ title: "Profile imported", description: "Review the details below before saving." });
      }
    } catch (e: any) {
      // Clear the autoFetched marker on failure so the user can retry by
      // editing the URL or pressing Import again without being silently blocked.
      setAutoFetched(null);
      toast({ title: "Couldn't read that link", description: e.message, variant: "destructive" });
    } finally {
      setFetchingUrl(false);
    }
  };

  // Keep latest handleUrlFetch in a ref so the auto-fetch effect doesn't
  // re-trigger on every render (handleUrlFetch is recreated each render).
  const handleUrlFetchRef = useRef(handleUrlFetch);
  useEffect(() => {
    handleUrlFetchRef.current = handleUrlFetch;
  });

  // Auto-fetch when the user pastes / finishes typing a valid URL in the URL tab.
  // Debounced ~600ms; never re-fires for the same URL or while another fetch is in flight.
  useEffect(() => {
    if (!open || mode !== "url") return;
    const trimmed = url.trim();
    if (!/^https?:\/\/[^\s]{6,}/i.test(trimmed)) return;
    if (autoFetched === trimmed) return;
    if (fetchingUrl) return;
    const timer = setTimeout(() => {
      setAutoFetched(trimmed);
      handleUrlFetchRef.current?.();
    }, 600);
    return () => clearTimeout(timer);
  }, [url, open, mode, autoFetched, fetchingUrl]);

  const needsOrgPicker = !accountId;
  // Organization is optional — backend buckets contacts without an org into a
  // system "Unassigned Contacts" account so the user can link them later.
  const canSave = name.trim().length > 0 && !saving;

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
      const res = await apiRequest("POST", "/api/contacts", {
        // Send accountId only when we have one — backend assigns the
        // "Unassigned Contacts" bucket otherwise.
        ...(finalAccountId ? { accountId: finalAccountId } : {}),
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

  const renderCardSlot = (side: CardSide) => {
    const slot = side === "front" ? front : back;
    const cameraRef = side === "front" ? frontCameraRef : backCameraRef;
    const uploadRef = side === "front" ? frontUploadRef : backUploadRef;
    const sideLabel = side === "front" ? "Front" : "Back";
    return (
      <div className="space-y-1.5" data-testid={`card-slot-${side}`}>
        <div className="flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{sideLabel}</Label>
          {slot.preview && (
            <button
              type="button"
              onClick={() => clearSide(side)}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid={`button-card-clear-${side}`}
            >
              <X className="h-3 w-3" /> Remove
            </button>
          )}
        </div>
        {slot.preview ? (
          <div className="relative rounded-lg overflow-hidden border border-border/60 bg-secondary/20">
            <img src={slot.preview} alt={`Card ${sideLabel.toLowerCase()}`} className="w-full h-32 object-contain" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="absolute top-1.5 right-1.5 h-6 px-2 text-[11px] gap-1"
              onClick={() => clearSide(side)}
              data-testid={`button-card-retake-${side}`}
            >
              <RotateCcw className="h-3 w-3" /> Retake
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 h-20 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition"
              data-testid={`button-card-camera-${side}`}
            >
              <Camera className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-medium">Take photo</span>
            </button>
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 h-20 rounded-lg border border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/5 transition"
              data-testid={`button-card-upload-${side}`}
            >
              <ImagePlus className="h-4 w-4 text-primary" />
              <span className="text-[11px] font-medium">Upload</span>
            </button>
          </div>
        )}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleSidePicked(side, e.target.files?.[0])}
          data-testid={`input-card-camera-${side}`}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleSidePicked(side, e.target.files?.[0])}
          data-testid={`input-card-upload-${side}`}
        />
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="dialog-create-contact">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> New contact
          </DialogTitle>
          <DialogDescription>
            Type it in, scan a business card (front and/or back), or paste a LinkedIn / website link.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as ContactMode)} className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="manual" data-testid="tab-mode-manual">Manual</TabsTrigger>
            <TabsTrigger value="url" data-testid="tab-mode-url">
              <Link2 className="h-3.5 w-3.5 mr-1" /> LinkedIn
            </TabsTrigger>
            <TabsTrigger value="card" data-testid="tab-mode-card">
              <Camera className="h-3.5 w-3.5 mr-1" /> Card
            </TabsTrigger>
          </TabsList>

          {/* Card scan — front + back */}
          <TabsContent value="card" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {renderCardSlot("front")}
              {renderCardSlot("back")}
            </div>
            <Button
              type="button"
              onClick={handleScanCard}
              disabled={scanning || (!front.file && !back.file)}
              className="w-full gap-1.5"
              data-testid="button-scan-card"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {scanning ? "Reading card…" : (front.file && back.file ? "Scan front + back" : "Scan card")}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Tip: place the card on a dark surface in good light. You can scan just the front, just the back, or both — we'll combine what we find.
            </p>
          </TabsContent>

          {/* URL extract — auto-fetches when a valid URL is pasted/typed */}
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
                  onClick={() => { setAutoFetched(url.trim()); handleUrlFetch(); }}
                  disabled={!url.trim() || fetchingUrl}
                  className="gap-1.5"
                  data-testid="button-fetch-url"
                >
                  {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {fetchingUrl ? "Reading…" : "Import"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                {fetchingUrl ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span>Reading the page and filling fields below…</span>
                  </>
                ) : autoFetched && autoFetched === url.trim() ? (
                  <>
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>Imported — review and edit anything below before saving.</span>
                  </>
                ) : (
                  <span>Paste a link and we'll fetch automatically. You can edit any field after.</span>
                )}
              </p>
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
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs">Account</Label>
                <span className="text-[11px] text-muted-foreground">Optional — link later</span>
              </div>
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
                      {pickedAccountName || (effectiveAccountId ? "Selected" : "Choose, type new, or skip…")}
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
