import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Link2,
  Loader2,
  CheckCircle2,
  Tag,
  X,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";

// ── Constants (mirror server/services/cortex-intel.ts URL_INTEL_CATEGORIES / URL_IMPORTANCE_LEVELS) ──

const URL_INTEL_CATEGORIES = [
  "Marine Industry Intel",
  "Marina / Port Lead",
  "Competitor Intel",
  "Funding / Grants",
  "Regulation / Compliance",
  "Product / Technology",
  "Customer Signal",
  "Partner / Channel",
  "Other",
] as const;

const URL_IMPORTANCE_LEVELS = [
  "Low",
  "Medium",
  "High",
  "Critical",
] as const;

const IMPORTANCE_COLORS: Record<string, string> = {
  "Low": "bg-muted/50 text-muted-foreground",
  "Medium": "bg-blue-500/15 text-blue-400",
  "High": "bg-amber-500/15 text-amber-400",
  "Critical": "bg-purple-500/15 text-purple-400",
};

function isLikelyValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Props ──────────────────────────────────────────────────────────────────

interface SaveUrlToCortexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SaveUrlToCortexModal({ open, onOpenChange, initialUrl }: SaveUrlToCortexModalProps) {
  const { toast } = useToast();

  const [url, setUrl] = useState(initialUrl || "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<string>("Marine Industry Intel");
  const [importance, setImportance] = useState<string>("Medium");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [useInAiContext, setUseInAiContext] = useState(true);
  const [saved, setSaved] = useState(false);
  const [duplicateRecord, setDuplicateRecord] = useState<any>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Reset state whenever the modal opens
  useEffect(() => {
    if (open) {
      setUrl(initialUrl || "");
      setTitle("");
      setSummary("");
      setNotes("");
      setCategory("Marine Industry Intel");
      setImportance("Medium");
      setTags([]);
      setTagInput("");
      setUseInAiContext(true);
      setSaved(false);
      setDuplicateRecord(null);
      setUrlError(null);
    }
  }, [open, initialUrl]);

  // Duplicate-check as the user finishes typing a URL
  const checkQuery = useQuery({
    queryKey: ["/api/cortex/url/check", url],
    queryFn: () =>
      fetch(`/api/cortex/url/check?url=${encodeURIComponent(url)}`, { credentials: "include" })
        .then((r) => r.json()),
    enabled: open && isLikelyValidUrl(url),
  });

  useEffect(() => {
    if (checkQuery.data?.exists && checkQuery.data?.record) {
      setDuplicateRecord(checkQuery.data.record);
    } else {
      setDuplicateRecord(null);
    }
  }, [checkQuery.data]);

  // Metadata prefill on blur
  const metadataMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cortex/url/fetch-metadata", { url }).then((r) => r.json()),
    onSuccess: (data) => {
      const meta = data?.meta;
      if (meta?.title && !title) setTitle(meta.title);
      if (meta?.description && !summary) setSummary(meta.description);
    },
  });

  const handleUrlBlur = () => {
    setUrlError(null);
    if (!url.trim()) return;
    if (!isLikelyValidUrl(url)) {
      setUrlError("Enter a valid http:// or https:// URL");
      return;
    }
    metadataMutation.mutate();
  };

  // Save
  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/cortex/url", {
        url: url.trim(),
        title: title || undefined,
        summary: summary || undefined,
        notes: notes || undefined,
        category,
        importance,
        tags,
        useInAiContext,
      }).then((r) => r.json()),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/cortex-intel"] });
      toast({ title: "Saved to Cortex", description: `${category} · ${importance}` });
    },
    onError: (err: any) => {
      if (err?.status === 409) {
        toast({ title: "Already saved", description: "This URL has already been saved to Cortex.", variant: "destructive" });
      } else if (err?.status === 400) {
        toast({ title: "Couldn't save", description: err?.message || "That URL isn't reachable or isn't allowed.", variant: "destructive" });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
      }
    },
  });

  // Tag helpers
  const addTag = (value: string) => {
    const t = value.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const isBusy = saveMutation.isPending;
  const canSave = isLikelyValidUrl(url) && !!category && !!importance && !duplicateRecord;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
              <Link2 className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold break-words [overflow-wrap:anywhere]">Save URL to Cortex</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words [overflow-wrap:anywhere]">
                Flag an article, report, or webpage as marine industry intelligence for Cortex to use in future emails, campaigns, and research.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {!saved && (
            <>
              {/* URL */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">URL *</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
                  onBlur={handleUrlBlur}
                  data-testid="url-input"
                  autoFocus
                />
                {urlError && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {urlError}
                  </p>
                )}
                {metadataMutation.isPending && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Fetching page details…
                  </p>
                )}
              </div>

              {/* Duplicate notice */}
              {duplicateRecord && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 min-w-0" data-testid="duplicate-notice">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-amber-400">Already saved to Cortex</p>
                      <p className="text-xs text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
                        {duplicateRecord.title || duplicateRecord.canonical_url}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Title */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Title</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Page title (auto-filled when available)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="title-input"
                />
              </div>

              {/* Category / Importance */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-8 text-xs" data-testid="category-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {URL_INTEL_CATEGORIES.map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Importance</Label>
                  <Select value={importance} onValueChange={setImportance}>
                    <SelectTrigger className="h-8 text-xs" data-testid="importance-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {URL_IMPORTANCE_LEVELS.map((l) => (
                        <SelectItem key={l} value={l} className="text-xs">
                          <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${IMPORTANCE_COLORS[l]}`}>
                            {l}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Summary */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Summary</Label>
                <Textarea
                  className="text-xs min-h-[64px] resize-none"
                  placeholder="Key takeaway from this page (auto-filled when available, editable)…"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  data-testid="summary-input"
                />
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tags</Label>
                <div className="flex gap-1.5 flex-wrap mb-1.5">
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] gap-1 pl-2 pr-1 h-5">
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="hover:text-destructive transition-colors"
                        data-testid={`remove-tag-${t}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Add tag and press Enter"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
                    }}
                    data-testid="tag-input"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => addTag(tagInput)}
                  >
                    <Tag className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Notes (optional)</Label>
                <Textarea
                  className="text-xs min-h-[60px] resize-none"
                  placeholder="Add any context or observations about why this is relevant..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="notes-input"
                />
              </div>

              {/* Use in AI context */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                <Checkbox
                  checked={useInAiContext}
                  onCheckedChange={(v) => setUseInAiContext(!!v)}
                  data-testid="use-in-ai-context-checkbox"
                  className="h-3.5 w-3.5"
                />
                Use this in AI email writing &amp; research context
              </label>

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => onOpenChange(false)}
                  disabled={isBusy}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-xs bg-cyan-600 hover:bg-cyan-700 gap-1.5"
                  onClick={() => saveMutation.mutate()}
                  disabled={isBusy || !canSave}
                  data-testid="save-url-button"
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  ) : (
                    <><Link2 className="h-3.5 w-3.5" /> Save to Cortex</>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* Success state */}
          {saved && (
            <div className="space-y-4">
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cyan-400">Saved to Cortex</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
                      {title || url} · <span className="font-medium">{category}</span> · {importance}
                    </p>
                  </div>
                </div>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> View source
              </a>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
