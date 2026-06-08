import { useState, useCallback, useRef } from "react";
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
  Upload, Images, Image, ImageOff,
} from "lucide-react";

type EmailSignature = {
  id: number;
  name: string;
  htmlContent: string;
  plainTextContent: string | null;
  isDefault: boolean;
  ctaImageUrl: string | null;
  ctaDestUrl: string | null;
  ctaAltText: string | null;
  ctaWidthPx: number | null;
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
  asset_id?: number | null;
};

type CtaAsset = {
  id: number;
  name: string;
  filename: string;
  original_name?: string | null;
  public_url: string;
  data_uri: string | null;
  mime_type: string;
  file_size: number | null;
  created_by_name: string | null;
  created_at: string;
  is_usable?: boolean;
  magic_ok?: boolean;
  has_file_data?: boolean;
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

type CtaConfig = {
  imageUrl: string;
  destUrl: string;
  altText: string;
  widthPx: string;
};

const DEFAULT_CTA_CONFIG: CtaConfig = {
  imageUrl: "",
  destUrl: "",
  altText: "Watch a Demo",
  widthPx: "180",
};

// ── CtaAssetImg — renders a CTA image with a clear fallback when the file is missing ──
function CtaAssetImg({
  src, alt, className, style,
}: { src: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 text-muted-foreground/50 bg-muted/30 rounded w-full h-full p-2"
        style={style}
        data-testid="cta-img-missing"
        title={`Image not found — re-upload to fix.\n${src}`}
      >
        <ImageOff className="h-4 w-4" />
        <span className="text-[9px] text-center leading-tight">Missing — re-upload</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setBroken(true)}
    />
  );
}

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

  // Left column: all contact/social/logo content
  const leftContent = `<div style="font-family:Arial,sans-serif;font-size:13px;color:#333;line-height:1.5;">
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

  return leftContent;
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

function wrapHtmlWithCta(baseHtml: string, cta: CtaConfig): string {
  if (!cta.imageUrl || !cta.destUrl) return baseHtml;
  const w = Math.max(80, Math.min(240, Number(cta.widthPx) || 180));
  const alt = (cta.altText || "Watch a Demo").replace(/"/g, "&quot;");
  const dest = safeUrl(cta.destUrl).replace(/"/g, "&quot;");
  const src = cta.imageUrl.replace(/"/g, "&quot;");
  const ctaCell = `<a href="${dest}" target="_blank" rel="noopener noreferrer" style="display:inline-block;"><img src="${src}" alt="${alt}" width="${w}" style="display:block;border:0;outline:none;text-decoration:none;max-width:${w}px;height:auto;border-radius:4px;"></a>`;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td style="vertical-align:top;">${baseHtml}</td><td style="vertical-align:middle;padding-left:24px;">${ctaCell}</td></tr></table>`;
}

// ─── CTA Picker Section (shared by Builder and HTML tabs) ─────────────────────
function CtaPickerSection({ cta, onChange }: { cta: CtaConfig; onChange: (c: CtaConfig) => void }) {
  const assetsQuery = useQuery<CtaAsset[]>({ queryKey: ["/api/cta-assets"] });
  const assets = assetsQuery.data ?? [];

  function setField(key: keyof CtaConfig, val: string) {
    onChange({ ...cta, [key]: val });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/60 pt-1 pb-0.5">CTA Image — Right Column</p>
      <p className="text-[11px] text-muted-foreground/60">
        Pick an image to show beside your signature. It appears in the right column and links to your demo URL.
      </p>

      {assetsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading CTA assets…
        </div>
      ) : assets.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 italic py-1">
          No CTA assets uploaded yet. Go to the CTA Assets tab to upload one.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 py-1">
          <button
            type="button"
            onClick={() => onChange({ ...cta, imageUrl: "", destUrl: "" })}
            className={`flex flex-col items-center justify-center rounded-lg border-2 p-2 w-16 h-16 text-[10px] transition-colors ${!cta.imageUrl ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-border"}`}
            data-testid="button-sig-cta-none"
          >
            <ImageOff className="h-4 w-4 mb-1" />
            None
          </button>
          {assets.map(asset => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onChange({
                ...cta,
                imageUrl: asset.data_uri || asset.public_url,
                destUrl: cta.destUrl || "https://www.voltsafemarine.com/demo",
                altText: cta.altText || asset.name,
              })}
              className={`relative rounded-lg border-2 overflow-hidden w-16 h-16 transition-colors ${cta.imageUrl === (asset.data_uri || asset.public_url) ? "border-primary ring-1 ring-primary" : "border-border/40 hover:border-border"}`}
              title={asset.name}
              data-testid={`button-sig-cta-asset-${asset.id}`}
            >
              <CtaAssetImg src={asset.public_url} alt={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}

      {cta.imageUrl && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-3 items-center gap-3">
            <Label className="text-right text-xs text-muted-foreground">Demo Link</Label>
            <Input
              value={cta.destUrl}
              onChange={e => setField("destUrl", e.target.value)}
              placeholder="https://www.voltsafemarine.com/demo"
              className="col-span-2 h-8 text-sm"
              data-testid="input-sig-ctaDestUrl"
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-3">
            <Label className="text-right text-xs text-muted-foreground">Alt Text</Label>
            <Input
              value={cta.altText}
              onChange={e => setField("altText", e.target.value)}
              placeholder="Watch a Demo"
              className="col-span-2 h-8 text-sm"
              data-testid="input-sig-ctaAltText"
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-3">
            <Label className="text-right text-xs text-muted-foreground">Width (px)</Label>
            <Input
              type="number"
              min={80}
              max={240}
              value={cta.widthPx}
              onChange={e => setField("widthPx", e.target.value)}
              placeholder="180"
              className="col-span-2 h-8 text-sm w-24"
              data-testid="input-sig-ctaWidthPx"
            />
          </div>
          {/* Live mini-preview */}
          <div className="rounded-lg border border-border/30 bg-white p-3 flex items-start gap-4 mt-1">
            <div className="text-[11px] text-gray-500 font-sans flex-1">
              <div className="font-bold text-gray-800 text-sm">Your Signature</div>
              <div className="text-[10px] text-cyan-600">Job Title</div>
              <div className="text-[10px] text-gray-500">Company</div>
            </div>
            <a href={cta.destUrl || "#"} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
              <CtaAssetImg
                src={cta.imageUrl}
                alt={cta.altText || "Watch a Demo"}
                style={{ width: Math.max(80, Math.min(240, Number(cta.widthPx) || 180)), height: "auto", borderRadius: 4, display: "block" }}
              />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Builder Form ─────────────────────────────────────────────────────────────

function BuilderForm({
  fields, onChange, cta, onCtaChange,
}: {
  fields: SigFields;
  onChange: (f: SigFields) => void;
  cta: CtaConfig;
  onCtaChange: (c: CtaConfig) => void;
}) {
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
      <CtaPickerSection cta={cta} onChange={onCtaChange} />
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
  // Existing signatures default to HTML tab so the builder cannot accidentally
  // overwrite saved custom HTML content.
  const [tab, setTab] = useState<"builder" | "preview" | "html">(() => existing ? "html" : "builder");
  const [htmlContent, setHtmlContent] = useState(() =>
    existing ? existing.htmlContent : buildSignatureHtml(DEFAULT_FIELDS)
  );
  const [fields, setFields] = useState<SigFields>(DEFAULT_FIELDS);
  const [ctaConfig, setCtaConfig] = useState<CtaConfig>(() => ({
    imageUrl: existing?.ctaImageUrl ?? "",
    destUrl: existing?.ctaDestUrl ?? "",
    altText: existing?.ctaAltText ?? "Watch a Demo",
    widthPx: String(existing?.ctaWidthPx ?? 180),
  }));

  // Detect dead/archived CTA on load so the user sees a warning before trying to send.
  const _ctaAssetsForWarning = useQuery<CtaAsset[]>({ queryKey: ["/api/cta-assets"] });
  const deadCtaFilename: string | null = (() => {
    if (!existing?.ctaImageUrl) return null;
    const fn = String(existing.ctaImageUrl).match(/\/assets\/cta\/([^/?#\s]+)$/)?.[1];
    if (!fn) return null;
    if (_ctaAssetsForWarning.isLoading) return null; // wait for data
    const usable = (_ctaAssetsForWarning.data ?? []).find(a => a.filename === fn);
    return usable ? null : fn; // null = ok; string = dead
  })();

  const handleFieldsChange = useCallback((f: SigFields) => {
    setFields(f);
    // For new signatures: live-update htmlContent from builder fields so the
    // preview stays in sync.
    // For existing signatures: do NOT auto-overwrite htmlContent — the user
    // must explicitly click "Generate from builder" to replace it. This prevents
    // accidentally destroying saved custom HTML by merely clicking a builder field.
    if (!existing) {
      setHtmlContent(buildSignatureHtml(f));
    }
  }, [existing]);

  // Preview: base signature HTML + CTA wrapped alongside (not below)
  const previewHtml = wrapHtmlWithCta(htmlContent, ctaConfig);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        htmlContent,
        plainTextContent: htmlToPlainText(htmlContent),
        isDefault: existing?.isDefault ?? false,
        ctaImageUrl: ctaConfig.imageUrl || null,
        ctaDestUrl: ctaConfig.destUrl || null,
        ctaAltText: ctaConfig.altText || null,
        ctaWidthPx: ctaConfig.widthPx ? Number(ctaConfig.widthPx) : null,
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

        {deadCtaFilename && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 mx-6 mt-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">CTA image is archived or missing</p>
              <p className="text-amber-300/70 mt-0.5">
                This signature references <span className="font-mono break-all">{deadCtaFilename}</span>, which is archived or has no image data. Sending will fail until you replace or remove it. Pick a valid image below, or click Clear.
              </p>
            </div>
            <Button
              type="button" size="sm" variant="outline"
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs h-7 shrink-0"
              onClick={() => setCtaConfig(c => ({ ...c, imageUrl: "", destUrl: "" }))}
              data-testid="button-sig-clear-dead-cta"
            >
              Clear CTA
            </Button>
          </div>
        )}

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
                <div className="space-y-2 mb-3">
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="mb-1.5">The builder creates a <strong>fresh signature</strong> from scratch. Filling in fields below will <strong>not</strong> change the current saved HTML until you click <strong>"Generate &amp; Replace"</strong>.</p>
                      <p className="text-amber-400/70">To keep your existing signature and only change the CTA image, use the <strong>Edit HTML</strong> tab instead.</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setHtmlContent(buildSignatureHtml(fields));
                      toast({ title: "HTML replaced from builder fields", description: "Click Save to persist the change." });
                    }}
                    className="w-full border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs h-7"
                    data-testid="button-sig-generate-from-builder"
                  >
                    <Wand2 className="h-3 w-3 mr-1.5" /> Generate &amp; Replace HTML from builder fields
                  </Button>
                </div>
              ) : null}
              <BuilderForm
                fields={fields}
                onChange={handleFieldsChange}
                cta={ctaConfig}
                onCtaChange={setCtaConfig}
              />
            </TabsContent>

            <TabsContent value="preview" className="mt-3">
              <div className="rounded-lg border border-border/40 bg-white p-6 min-h-[200px]">
                {previewHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <p className="text-sm text-gray-400 italic">Fill in the Builder or HTML fields to see a preview.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground/50 mt-2">
                Preview on white background — {ctaConfig.imageUrl ? "CTA image shown in right column as recipients will see it." : "no CTA selected."}
              </p>
            </TabsContent>

            <TabsContent value="html" className="mt-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground mb-3">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                <p>Advanced mode. Edit raw HTML directly. Dangerous code (scripts, event handlers) will be stripped automatically on save. The CTA image below is stored separately and injected at send time — it will NOT appear in the raw HTML.</p>
              </div>
              <Textarea
                value={htmlContent}
                onChange={e => setHtmlContent(e.target.value)}
                className="font-mono text-xs min-h-[280px] resize-y"
                placeholder="<div>Your custom HTML signature...</div>"
                data-testid="textarea-sig-html"
              />
              <div className="mt-4 pt-3 border-t border-border/30">
                <CtaPickerSection cta={ctaConfig} onChange={setCtaConfig} />
              </div>
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
  const [uploading, setUploading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(existing?.asset_id ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const libraryQuery = useQuery<CtaAsset[]>({
    queryKey: ["/api/cta-assets"],
    enabled: showLibrary,
  });

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/cta-assets/upload", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Upload failed"); }
      const asset: CtaAsset = await res.json();
      setImageUrl(asset.data_uri || asset.public_url);
      setSelectedAssetId(asset.id);
      queryClient.invalidateQueries({ queryKey: ["/api/cta-assets"] });
      toast({ title: "Image uploaded", description: "URL filled in automatically." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const applyPreset = async () => {
    setName("Watch a Demo");
    setType("image");
    setDestinationUrl("https://www.voltsafemarine.com/demo");
    setAltText("Watch a Demo");
    setWidthPx("200");
    setTrackingEnabled(true);
    // Try to auto-select an existing WatchDemo asset from the library
    try {
      const assets: CtaAsset[] = await fetch("/api/cta-assets", { credentials: "include" }).then(r => r.json());
      queryClient.setQueryData(["/api/cta-assets"], assets);
      // Prefer the 200px variant (for signature embed) when both sizes exist
      const demo = assets.find(a => /watchdemo_thumbnail_200/i.test(a.name) || /watchdemo_thumbnail_200/i.test(a.filename))
        || assets.find(a => a.name.toLowerCase().includes("watchdemo") || a.filename.toLowerCase().includes("watchdemo"));
      if (demo) {
        setImageUrl(demo.public_url);
        setSelectedAssetId(demo.id);
        toast({ title: "Preset applied", description: `Using "${demo.name}" from your CTA library.` });
      } else {
        setImageUrl("");
        setSelectedAssetId(null);
        toast({
          title: "Preset applied",
          description: "Upload a 'WatchDemo' image in CTA Assets to complete this preset.",
        });
      }
    } catch {
      setImageUrl("");
      setSelectedAssetId(null);
    }
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
        assetId: selectedAssetId ?? undefined,
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
                <Label className="text-xs text-muted-foreground mb-1 block">Image</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }}
                />
                <div className="flex gap-1 mb-2">
                  <Button type="button" size="sm" variant="outline"
                    className="flex-1 text-xs h-7 gap-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    data-testid="button-upload-cta-image"
                  >
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Upload
                  </Button>
                  <Button type="button" size="sm" variant="outline"
                    className={`flex-1 text-xs h-7 gap-1 ${showLibrary ? "border-primary text-primary" : ""}`}
                    onClick={() => setShowLibrary(v => !v)}
                    data-testid="button-select-from-library"
                  >
                    <Images className="h-3 w-3" /> Library
                  </Button>
                </div>
                {showLibrary && (
                  <div className="border border-border/40 rounded-md p-2 max-h-40 overflow-y-auto mb-2 bg-muted/20">
                    {libraryQuery.isLoading ? (
                      <div className="flex justify-center p-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
                    ) : (libraryQuery.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 text-center py-2">No uploaded images yet. Upload one above.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {(libraryQuery.data ?? []).map(asset => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => { setImageUrl(asset.data_uri || asset.public_url); setSelectedAssetId(asset.id); setShowLibrary(false); }}
                            className={`rounded border overflow-hidden transition-colors ${imageUrl === (asset.data_uri || asset.public_url) ? "border-primary ring-1 ring-primary" : "border-border/40 hover:border-primary/50"}`}
                            title={asset.name}
                            data-testid={`button-select-asset-${asset.id}`}
                          >
                            <CtaAssetImg src={asset.public_url} alt={asset.name} className="w-full h-12 object-cover bg-muted/30" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {imageUrl && (
                  <div className="mb-2 rounded-md border border-border/30 overflow-hidden bg-muted/10" style={{ minHeight: "4rem" }}>
                    <CtaAssetImg src={imageUrl} alt="Preview" className="w-full max-h-16 object-contain" />
                  </div>
                )}
                <Input value={imageUrl} onChange={e => { setImageUrl(e.target.value); setSelectedAssetId(null); }}
                  placeholder="https://... (or upload above)"
                  className="h-8 text-xs" data-testid="input-cta-image-url" />
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

// ── CtaAssetLibraryTab — upload + manage CTA image assets ───────────────────
function CtaAssetLibraryTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: assets = [], isLoading } = useQuery<CtaAsset[]>({
    queryKey: ["/api/cta-assets"],
  });

  const renameMutation = useMutation({
    mutationFn: (item: { id: number; name: string }) =>
      apiRequest("PUT", `/api/cta-assets/${item.id}`, { name: item.name }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cta-assets"] });
      setRenamingId(null);
    },
    onError: (e: any) => toast({ title: "Rename failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/cta-assets/${id}`).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).message || "Delete failed"); }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cta-assets"] });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/cta-assets/upload", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message || "Upload failed"); }
      queryClient.invalidateQueries({ queryKey: ["/api/cta-assets"] });
      toast({ title: "Image uploaded to CTA library" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (n: number | null) => {
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Uploaded images get stable public URLs you can use in tracked CTAs and compose emails.
        </p>
        <div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ""; }} />
          <Button size="sm" className="gap-1.5 bg-primary text-primary-foreground"
            onClick={() => fileInputRef.current?.click()} disabled={uploading}
            data-testid="button-upload-cta-asset">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload Image
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      ) : assets.length === 0 ? (
        <Card className="border-border/40">
          <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-11 h-11 rounded-xl bg-muted/30 flex items-center justify-center">
              <Image className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <div className="text-center">
              <p className="font-medium text-muted-foreground">No images yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Upload PNG, JPG, or WEBP images for use in CTAs.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {assets.map(asset => (
            <Card key={asset.id} className="border-border/40 overflow-hidden" data-testid={`card-asset-${asset.id}`}>
              <div className="bg-muted/20 flex items-center justify-center h-24 overflow-hidden">
                <CtaAssetImg src={asset.public_url} alt={asset.name} className="max-h-full max-w-full object-contain" />
              </div>
              <CardContent className="p-2.5">
                {renamingId === asset.id ? (
                  <div className="flex gap-1">
                    <Input
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") renameMutation.mutate({ id: asset.id, name: renameVal });
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-6 text-xs flex-1"
                      autoFocus
                      data-testid={`input-rename-asset-${asset.id}`}
                    />
                    <button onClick={() => renameMutation.mutate({ id: asset.id, name: renameVal })}
                      className="text-primary text-[10px] hover:underline" data-testid={`button-confirm-rename-${asset.id}`}>
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" title={asset.name}>{asset.name}</p>
                      {asset.file_size && <p className="text-[10px] text-muted-foreground/50">{formatBytes(asset.file_size)}</p>}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => { navigator.clipboard.writeText(asset.public_url).catch(() => {}); toast({ title: "URL copied" }); }}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                        title="Copy public URL"
                        data-testid={`button-copy-url-asset-${asset.id}`}>
                        <Copy className="h-3 w-3" />
                      </button>
                      <button onClick={() => { setRenamingId(asset.id); setRenameVal(asset.name); }}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                        title="Rename" data-testid={`button-rename-asset-${asset.id}`}>
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setDeleteId(asset.id)}
                        className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                        title="Delete" data-testid={`button-delete-asset-${asset.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/40 mt-1 truncate" title={asset.public_url}
                   data-testid={`text-asset-url-${asset.id}`}>
                  {asset.public_url.replace(/^https?:\/\/[^/]+/, "")}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {asset.created_by_name && (
                    <p className="text-[10px] text-muted-foreground/40 truncate" data-testid={`text-asset-creator-${asset.id}`}>
                      {asset.created_by_name}
                    </p>
                  )}
                  {asset.created_by_name && asset.created_at && <span className="text-[10px] text-muted-foreground/30">·</span>}
                  {asset.created_at && (
                    <p className="text-[10px] text-muted-foreground/40 shrink-0" data-testid={`text-asset-date-${asset.id}`}>
                      {new Date(asset.created_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={v => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete CTA Image?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will be archived. Emails already sent with this image will still display it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-asset-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-asset-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function SignatureSettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [pageTab, setPageTab] = useState<"signatures" | "assets">("signatures");
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
            <p className="text-xs text-muted-foreground">Create and manage your email signatures and CTA images.</p>
          </div>
        </div>
        {pageTab === "signatures" && (
          <Button
            size="sm"
            onClick={() => setEditSig(null)}
            className="bg-primary text-primary-foreground gap-1.5"
            data-testid="button-new-signature"
          >
            <Plus className="h-4 w-4" /> New Signature
          </Button>
        )}
      </div>

      {/* Page-level tab switcher */}
      <div className="flex gap-1 border-b border-border/40 pb-0">
        <button
          onClick={() => setPageTab("signatures")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${pageTab === "signatures" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-signatures"
        >
          Signatures
        </button>
        <button
          onClick={() => setPageTab("assets")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${pageTab === "assets" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-cta-assets"
        >
          <Images className="h-3.5 w-3.5" /> CTA Assets
        </button>
      </div>

      {/* CTA Asset Library tab */}
      {pageTab === "assets" && <CtaAssetLibraryTab />}

      {/* Signature List */}
      {pageTab === "signatures" && (<>
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
      </>)}
    </div>
  );
}
