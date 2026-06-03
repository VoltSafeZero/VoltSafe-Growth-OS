import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, Plus, Pencil, Trash2, Star, Copy, Loader2, PenSquare, AlertTriangle,
  Eye, Code2, Wand2, MousePointerClick, ToggleLeft, ToggleRight,
} from "lucide-react";

type EmailSignature = {
  id: number;
  name: string;
  htmlContent: string;
  plainTextContent: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type SignatureCta = {
  id: number;
  signature_id: number | null;
  name: string;
  type: string;
  destination_url: string;
  image_url: string | null;
  alt_text: string | null;
  width_px: number | null;
  tracking_enabled: boolean;
};

type SigFields = {
  fullName: string;
  jobTitle: string;
  company: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;
  linkedin: string;
  twitter: string;
  instagram: string;
  youtube: string;
  brandColor: string;
};

const DEFAULT_FIELDS: SigFields = {
  fullName: "", jobTitle: "", company: "", email: "", phone: "", mobile: "",
  website: "", address: "", linkedin: "", twitter: "", instagram: "", youtube: "",
  brandColor: "#00C1DE",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Block javascript:/vbscript:/data: in URLs placed into href attributes */
function safeUrl(url: string): string {
  if (!url) return "";
  const lower = url.toLowerCase().replace(/[\s\u200b\u00ad]/g, "");
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("data:")) return "#";
  return url;
}

function buildSignatureHtml(f: SigFields): string {
  const color = f.brandColor || "#00C1DE";
  const phoneLinks: string[] = [];
  if (f.phone) phoneLinks.push(`<b style="color:#555;">P:</b> <a href="tel:${esc(f.phone)}" style="text-decoration:none;color:#787f84;">${esc(f.phone)}</a>`);
  if (f.mobile) phoneLinks.push(`<b style="color:#555;">M:</b> <a href="tel:${esc(f.mobile)}" style="text-decoration:none;color:#787f84;">${esc(f.mobile)}</a>`);
  const socials: string[] = [];
  if (f.linkedin) socials.push(`<a href="${esc(safeUrl(f.linkedin))}" style="color:${color};text-decoration:none;">LinkedIn</a>`);
  if (f.twitter) socials.push(`<a href="${esc(safeUrl(f.twitter))}" style="color:${color};text-decoration:none;">X / Twitter</a>`);
  if (f.instagram) socials.push(`<a href="${esc(safeUrl(f.instagram))}" style="color:${color};text-decoration:none;">Instagram</a>`);
  if (f.youtube) socials.push(`<a href="${esc(safeUrl(f.youtube))}" style="color:${color};text-decoration:none;">YouTube</a>`);

  const rawWebsite = f.website ? (f.website.startsWith("http") ? f.website : `https://${f.website}`) : "";
  const websiteHref = safeUrl(rawWebsite);

  return `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333;line-height:1.5;">
<p style="margin:0 0 14px 0;font-size:13px;">Best regards,</p>
<table cellpadding="0" cellspacing="0" border="0" style="min-width:280px;">
  <tbody>
    <tr>
      <td style="padding-bottom:4px;">
        ${f.fullName ? `<p style="margin:0;font-size:16px;font-weight:bold;color:#111;letter-spacing:0.01em;">${esc(f.fullName)}</p>` : ""}
        ${f.jobTitle ? `<p style="margin:2px 0 0 0;font-size:12px;color:${color};">${esc(f.jobTitle)}</p>` : ""}
        ${f.company ? `<p style="margin:2px 0 0 0;font-size:12px;color:#555;">${esc(f.company)}</p>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:6px 0 8px 0;">
        <hr style="border:none;border-top:1px solid #d0d0d0;margin:0;">
      </td>
    </tr>
    <tr>
      <td>
        <p style="margin:0;font-size:12px;color:#787f84;line-height:1.8;">
          ${f.email ? `<a href="mailto:${esc(f.email)}" style="color:#787f84;text-decoration:none;">${esc(f.email)}</a><br>` : ""}
          ${phoneLinks.length > 0 ? phoneLinks.join(" &nbsp;|&nbsp; ") + "<br>" : ""}
          ${websiteHref ? `<a href="${esc(websiteHref)}" style="color:#787f84;text-decoration:none;">${esc(f.website)}</a><br>` : ""}
          ${f.address ? `${esc(f.address)}<br>` : ""}
        </p>
        ${socials.length > 0 ? `<p style="margin:4px 0 0 0;font-size:11px;color:#787f84;">Follow us: ${socials.join(" | ")}</p>` : ""}
      </td>
    </tr>
  </tbody>
</table>
</div>`;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Builder Form ─────────────────────────────────────────────────────────────

function BuilderForm({ fields, onChange }: { fields: SigFields; onChange: (f: SigFields) => void }) {
  function set(key: keyof SigFields, val: string) {
    onChange({ ...fields, [key]: val });
  }
  const row = (label: string, key: keyof SigFields, placeholder?: string, type = "text") => (
    <div className="grid grid-cols-3 items-center gap-3">
      <Label className="text-right text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={fields[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        className="col-span-2 h-8 text-sm"
        data-testid={`input-sig-${key}`}
      />
    </div>
  );
  return (
    <div className="space-y-2.5 py-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 pb-1">Contact Info</p>
      {row("Full Name", "fullName", "Your Name")}
      {row("Job Title", "jobTitle", "e.g. Sales Manager")}
      {row("Company", "company", "Your Company")}
      {row("Email", "email", "you@company.com", "email")}
      {row("Phone", "phone", "+1 555 000 0000", "tel")}
      {row("Mobile", "mobile", "+1 555 000 0001", "tel")}
      {row("Website", "website", "https://company.com")}
      {row("Address", "address", "123 Main St, City")}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 pt-2 pb-1">Social Links</p>
      {row("LinkedIn", "linkedin", "https://linkedin.com/in/...")}
      {row("X / Twitter", "twitter", "https://twitter.com/...")}
      {row("Instagram", "instagram", "https://instagram.com/...")}
      {row("YouTube", "youtube", "https://youtube.com/...")}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 pt-2 pb-1">Branding</p>
      <div className="grid grid-cols-3 items-center gap-3">
        <Label className="text-right text-xs text-muted-foreground">Brand Color</Label>
        <div className="col-span-2 flex items-center gap-2">
          <input
            type="color"
            value={fields.brandColor}
            onChange={e => set("brandColor", e.target.value)}
            className="h-8 w-12 rounded border border-border/50 bg-transparent cursor-pointer"
            data-testid="input-sig-brandColor"
          />
          <Input
            value={fields.brandColor}
            onChange={e => set("brandColor", e.target.value)}
            placeholder="#00C1DE"
            className="h-8 text-sm w-28"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Dialog ─────────────────────────────────────────────────────

function SignatureDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: EmailSignature | null;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(() => existing?.name ?? "");
  const [tab, setTab] = useState<"builder" | "preview" | "html">("builder");
  const [htmlContent, setHtmlContent] = useState(() =>
    existing ? existing.htmlContent : buildSignatureHtml(DEFAULT_FIELDS)
  );
  const [fields, setFields] = useState<SigFields>(DEFAULT_FIELDS);

  const handleFieldsChange = useCallback((f: SigFields) => {
    setFields(f);
    setHtmlContent(buildSignatureHtml(f));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        htmlContent,
        plainTextContent: htmlToPlainText(htmlContent),
        isDefault: existing?.isDefault ?? false,
      };
      if (existing) {
        const res = await apiRequest("PUT", `/api/signatures/${existing.id}`, body);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Failed to save"); }
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/signatures", body);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Failed to create"); }
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: existing ? "Signature updated" : "Signature created" });
      queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed to save signature", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Signature" : "New Signature"}</DialogTitle>
          <DialogDescription>
            {existing ? "Update your email signature." : "Create a new email signature to use in your outgoing emails."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-1 pr-1">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Signature Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Corporate Signature"
              className="h-9"
              data-testid="input-sig-name"
            />
          </div>

          <Tabs value={tab} onValueChange={v => setTab(v as any)}>
            <TabsList className="h-8 text-xs">
              <TabsTrigger value="builder" className="gap-1.5 text-xs" data-testid="tab-sig-builder">
                <Wand2 className="h-3 w-3" /> Builder
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs" data-testid="tab-sig-preview">
                <Eye className="h-3 w-3" /> Preview
              </TabsTrigger>
              <TabsTrigger value="html" className="gap-1.5 text-xs" data-testid="tab-sig-html">
                <Code2 className="h-3 w-3" /> Edit HTML
              </TabsTrigger>
            </TabsList>

            <TabsContent value="builder" className="mt-3">
              {existing ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 mb-3">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p>This signature was saved with custom HTML. Use the <strong>Edit HTML</strong> tab to modify it directly, or use the builder below to generate a fresh signature.</p>
                </div>
              ) : null}
              <BuilderForm fields={fields} onChange={handleFieldsChange} />
            </TabsContent>

            <TabsContent value="preview" className="mt-3">
              <div className="rounded-lg border border-border/40 bg-white p-6 min-h-[200px]">
                {htmlContent ? (
                  <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
                ) : (
                  <p className="text-sm text-gray-400 italic">Fill in the Builder fields to see a preview.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground/50 mt-2">Preview shown on white background to match email clients.</p>
            </TabsContent>

            <TabsContent value="html" className="mt-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground mb-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                <p>Advanced mode. Edit raw HTML directly. Dangerous code (scripts, event handlers) will be stripped automatically on save.</p>
              </div>
              <Textarea
                value={htmlContent}
                onChange={e => setHtmlContent(e.target.value)}
                className="font-mono text-xs min-h-[280px] resize-y"
                placeholder="<div>Your custom HTML signature...</div>"
                data-testid="textarea-sig-html"
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="pt-2 border-t border-border/30">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-sig-cancel">Cancel</Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || !htmlContent.trim() || saveMutation.isPending}
            className="bg-primary text-primary-foreground"
            data-testid="button-sig-save"
          >
            {saveMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving…</> : "Save Signature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ── CtaDialog — create / edit a tracked CTA for a signature ────────────────
function CtaDialog({
  open, signatureId, existing, onClose,
}: {
  open: boolean;
  signatureId: number;
  existing?: SignatureCta;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState(existing?.type ?? "image");
  const [destinationUrl, setDestinationUrl] = useState(existing?.destination_url ?? "");
  const [imageUrl, setImageUrl] = useState(existing?.image_url ?? "");
  const [altText, setAltText] = useState(existing?.alt_text ?? "Watch a Demo");
  const [widthPx, setWidthPx] = useState(String(existing?.width_px ?? 200));
  const [trackingEnabled, setTrackingEnabled] = useState(existing?.tracking_enabled ?? true);

  const applyPreset = () => {
    setName("Watch a Demo");
    setType("image");
    setDestinationUrl("https://voltsafemarine.com/demo");
    setAltText("Watch a Demo");
    setWidthPx("200");
    setTrackingEnabled(true);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        signatureId, name: name.trim(), type,
        destinationUrl: destinationUrl.trim(),
        imageUrl: imageUrl.trim() || null,
        altText: altText.trim() || null,
        widthPx: Number(widthPx) || 200,
        trackingEnabled,
      };
      if (existing) {
        const res = await apiRequest("PUT", `/api/signature-ctas/${existing.id}`, body);
        if (!res.ok) throw new Error("Failed to update");
        return res.json();
      }
      const res = await apiRequest("POST", "/api/signature-ctas", body);
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signature-ctas", signatureId] });
      toast({ title: existing ? "CTA updated" : "CTA created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save CTA", variant: "destructive" }),
  });

  const canSave = name.trim().length > 0 && destinationUrl.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Tracked CTA" : "Add Tracked CTA"}</DialogTitle>
          <DialogDescription>
            A tracked CTA logs clicks with CRM attribution so you know who engaged with your signature.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {!existing && (
            <Button
              type="button" size="sm" variant="outline"
              className="w-full text-xs gap-1.5 border-primary/40 text-primary"
              onClick={applyPreset}
              data-testid="button-cta-preset-demo"
            >
              <MousePointerClick className="h-3 w-3" /> Use "Watch a Demo" preset
            </Button>
          )}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Watch a Demo"
              className="h-8 text-xs" data-testid="input-cta-name" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Destination URL</Label>
            <Input value={destinationUrl} onChange={e => setDestinationUrl(e.target.value)}
              placeholder="https://voltsafemarine.com/demo"
              className="h-8 text-xs" data-testid="input-cta-dest-url" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full h-8 text-xs bg-background border border-input rounded-md px-2"
              data-testid="select-cta-type">
              <option value="image">Image</option>
              <option value="text">Text Link</option>
              <option value="button">Button</option>
            </select>
          </div>
          {type === "image" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Image URL</Label>
                <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                  placeholder="https://..." className="h-8 text-xs" data-testid="input-cta-image-url" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Alt Text</Label>
                <Input value={altText} onChange={e => setAltText(e.target.value)}
                  placeholder="Watch a Demo" className="h-8 text-xs" data-testid="input-cta-alt-text" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Width (px)</Label>
                <Input type="number" value={widthPx} onChange={e => setWidthPx(e.target.value)}
                  className="h-8 text-xs" data-testid="input-cta-width" />
              </div>
            </>
          )}
          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs text-muted-foreground">Tracking enabled</Label>
            <button type="button" onClick={() => setTrackingEnabled(v => !v)}
              className={trackingEnabled ? "text-primary" : "text-muted-foreground/40"}
              data-testid="button-cta-tracking-toggle">
              {trackingEnabled
                ? <ToggleRight className="h-5 w-5" />
                : <ToggleLeft className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()} data-testid="button-save-cta">
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save CTA"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CtaSection — inline CTA list + management for a signature card ───────────
function CtaSection({ signatureId }: { signatureId: number }) {
  const [showDialog, setShowDialog] = useState(false);
  const [editCta, setEditCta] = useState<SignatureCta | null>(null);
  const { toast } = useToast();

  const { data: ctas = [], isLoading: ctasLoading } = useQuery<SignatureCta[]>({
    queryKey: ["/api/signature-ctas", signatureId],
    queryFn: () =>
      fetch(`/api/signature-ctas?signatureId=${signatureId}`, { credentials: "include" })
        .then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/signature-ctas/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/signature-ctas", signatureId] }),
    onError: () => toast({ title: "Failed to delete CTA", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: (cta: SignatureCta) =>
      apiRequest("PUT", `/api/signature-ctas/${cta.id}`, {
        name: cta.name,
        type: cta.type,
        destinationUrl: cta.destination_url,
        imageUrl: cta.image_url,
        altText: cta.alt_text,
        widthPx: cta.width_px,
        trackingEnabled: !cta.tracking_enabled,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/signature-ctas", signatureId] }),
  });

  return (
    <div className="mt-3 pt-3 border-t border-border/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <MousePointerClick className="h-3 w-3" /> Tracked CTAs
        </span>
        <button
          onClick={() => { setEditCta(null); setShowDialog(true); }}
          className="text-[11px] flex items-center gap-0.5 text-primary hover:underline"
          data-testid={`button-add-cta-${signatureId}`}
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      {ctasLoading ? (
        <div className="h-5 bg-muted/20 rounded animate-pulse" />
      ) : ctas.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/40 italic">No tracked CTAs</p>
      ) : (
        <div className="space-y-1.5">
          {ctas.map(cta => (
            <div key={cta.id} className="flex items-center gap-1.5 text-[11px]"
              data-testid={`cta-row-${cta.id}`}>
              <button
                onClick={() => toggleMutation.mutate(cta)}
                className={cta.tracking_enabled ? "text-primary shrink-0" : "text-muted-foreground/30 shrink-0"}
                title={cta.tracking_enabled ? "Tracking on — click to disable" : "Tracking off — click to enable"}
              >
                {cta.tracking_enabled
                  ? <ToggleRight className="h-3.5 w-3.5" />
                  : <ToggleLeft className="h-3.5 w-3.5" />}
              </button>
              <span className="font-medium truncate max-w-[90px]">{cta.name}</span>
              <span className="text-muted-foreground/50 truncate flex-1 min-w-0">
                {cta.destination_url}
              </span>
              <button
                onClick={() => { setEditCta(cta); setShowDialog(true); }}
                className="shrink-0 text-muted-foreground hover:text-foreground p-0.5"
                title="Edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => deleteMutation.mutate(cta.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive p-0.5"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {showDialog && (
        <CtaDialog
          open
          signatureId={signatureId}
          existing={editCta ?? undefined}
          onClose={() => { setShowDialog(false); setEditCta(null); }}
        />
      )}
    </div>
  );
}

export default function SignatureSettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editSig, setEditSig] = useState<EmailSignature | null | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: signatures = [], isLoading } = useQuery<EmailSignature[]>({
    queryKey: ["/api/signatures"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/signatures/${id}`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Delete failed"); }
    },
    onSuccess: () => {
      toast({ title: "Signature deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
      setDeleteId(null);
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/signatures/${id}/set-default`);
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Default signature updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
    },
    onError: (err: any) => toast({ title: "Failed to set default", description: err.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (sig: EmailSignature) => {
      const res = await apiRequest("POST", "/api/signatures", {
        name: `${sig.name} (Copy)`,
        htmlContent: sig.htmlContent,
        plainTextContent: sig.plainTextContent,
        isDefault: false,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Signature duplicated" });
      queryClient.invalidateQueries({ queryKey: ["/api/signatures"] });
    },
    onError: (err: any) => toast({ title: "Failed to duplicate", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/settings")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-back-to-settings"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Email Signatures</h1>
            <p className="text-xs text-muted-foreground">Create and manage your email signatures.</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setEditSig(null)}
          className="bg-primary text-primary-foreground gap-1.5"
          data-testid="button-new-signature"
        >
          <Plus className="h-4 w-4" /> New Signature
        </Button>
      </div>

      {/* Signature List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-28 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      ) : signatures.length === 0 ? (
        <Card className="border-border/40">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center">
              <PenSquare className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div className="text-center">
              <p className="font-medium text-muted-foreground">No signatures yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Create your first signature to use in outgoing emails.</p>
            </div>
            <Button
              size="sm"
              onClick={() => setEditSig(null)}
              className="bg-primary text-primary-foreground gap-1.5 mt-2"
              data-testid="button-create-first-signature"
            >
              <Plus className="h-4 w-4" /> Create Signature
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {signatures.map(sig => (
            <Card
              key={sig.id}
              className={`border-border/40 transition-colors ${sig.isDefault ? "border-primary/40 bg-primary/5" : "bg-card"}`}
              data-testid={`card-sig-${sig.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm">{sig.name}</span>
                      {sig.isDefault && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-primary/30 border">
                          <Star className="h-2.5 w-2.5 mr-0.5" /> Default
                        </Badge>
                      )}
                    </div>
                    {/* Mini preview */}
                    <div
                      className="text-xs opacity-50 pointer-events-none select-none line-clamp-3 bg-white/5 rounded p-2 border border-border/20"
                      dangerouslySetInnerHTML={{ __html: sig.htmlContent }}
                    />
                    <CtaSection signatureId={sig.id} />
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {!sig.isDefault && (
                      <button
                        onClick={() => setDefaultMutation.mutate(sig.id)}
                        disabled={setDefaultMutation.isPending}
                        title="Set as default"
                        className="p-1.5 rounded text-muted-foreground hover:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                        data-testid={`button-sig-default-${sig.id}`}
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => duplicateMutation.mutate(sig)}
                      disabled={duplicateMutation.isPending}
                      title="Duplicate"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                      data-testid={`button-sig-duplicate-${sig.id}`}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditSig(sig)}
                      title="Edit"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                      data-testid={`button-sig-edit-${sig.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(sig.id)}
                      title="Delete"
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      data-testid={`button-sig-delete-${sig.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog — editSig===undefined means closed, null means new, object means edit */}
      {editSig !== undefined && (
        <SignatureDialog
          key={editSig?.id ?? "new"}
          open
          onClose={() => setEditSig(undefined)}
          existing={editSig ?? undefined}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Signature?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this signature. Emails already sent will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
