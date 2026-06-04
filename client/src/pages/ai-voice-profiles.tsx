import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Plus, Pencil, Trash2, Globe, User, Star, Upload,
  ChevronRight, ChevronLeft, X, Loader2, Check, FileText, Download,
  Sparkles, AlertTriangle, BookOpen, Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface VoiceProfile {
  id: number;
  ownerUserId: number | null;
  name: string;
  description: string | null;
  profileType: "global" | "user";
  systemInstructions: string | null;
  styleRules: string | null;
  forbiddenPhrases: string | null;
  preferredPhrases: string | null;
  exampleMessagesJson: string;
  knowledgeSummary: string | null;
  sourceLabel: string | null;
  isDefault: boolean;
  isActive: boolean;
  files?: VoiceProfileFile[];
}

interface VoiceProfileFile {
  id: number;
  voiceProfileId: number;
  originalFilename: string;
  fileType: string;
  extractedText: string | null;
  textSummary: string | null;
  createdAt: string;
}

// ── Profile Card ──────────────────────────────────────────────────────────────

function ProfileCard({
  profile,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  profile: VoiceProfile;
  isDefault: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div
      data-testid={`card-voice-profile-${profile.id}`}
      className={cn(
        "rounded-lg border p-4 space-y-2 transition-colors",
        isDefault
          ? "border-primary/40 bg-primary/5"
          : "border-border/60 bg-card hover:border-border"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {profile.profileType === "global" ? (
            <Globe className="h-4 w-4 text-primary shrink-0" />
          ) : (
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium text-sm truncate">{profile.name}</span>
          {isDefault && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary shrink-0">
              Default
            </Badge>
          )}
          {profile.profileType === "global" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              Global
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isDefault && (
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-primary"
              onClick={onSetDefault}
              data-testid={`button-set-default-${profile.id}`}
            >
              <Star className="h-3 w-3 mr-1" />Set default
            </Button>
          )}
          <Button
            size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            data-testid={`button-edit-profile-${profile.id}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!profile.isDefault && (
            <Button
              size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              data-testid={`button-delete-profile-${profile.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {profile.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{profile.description}</p>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 flex-wrap">
        {profile.sourceLabel && (
          <span className="flex items-center gap-1">
            <BookOpen className="h-3 w-3" />{profile.sourceLabel}
          </span>
        )}
        {profile.files && profile.files.length > 0 && (
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />{profile.files.length} knowledge file{profile.files.length !== 1 ? "s" : ""}
          </span>
        )}
        {(() => {
          try {
            const ex: string[] = JSON.parse(profile.exampleMessagesJson ?? "[]");
            return Array.isArray(ex) && ex.length > 0 ? (
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />{ex.length} example{ex.length !== 1 ? "s" : ""}
              </span>
            ) : null;
          } catch { return null; }
        })()}
      </div>
    </div>
  );
}

// ── Edit / Create Dialog ──────────────────────────────────────────────────────

function ProfileEditDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: VoiceProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>("basic");

  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [sourceLabel, setSourceLabel] = useState(profile?.sourceLabel ?? "");
  const [systemInstructions, setSystemInstructions] = useState(profile?.systemInstructions ?? "");
  const [styleRules, setStyleRules] = useState(profile?.styleRules ?? "");
  const [forbiddenPhrases, setForbiddenPhrases] = useState(profile?.forbiddenPhrases ?? "");
  const [preferredPhrases, setPreferredPhrases] = useState(profile?.preferredPhrases ?? "");
  const [exampleMessages, setExampleMessages] = useState<string[]>(() => {
    try { return JSON.parse(profile?.exampleMessagesJson ?? "[]"); } catch { return []; }
  });
  const [knowledgeSummary, setKnowledgeSummary] = useState(profile?.knowledgeSummary ?? "");
  const [saving, setSaving] = useState(false);

  // Files management
  const [files, setFiles] = useState<VoiceProfileFile[]>(profile?.files ?? []);
  const [newFileText, setNewFileText] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [addingFile, setAddingFile] = useState(false);
  const qc = useQueryClient();

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        sourceLabel: sourceLabel.trim() || null,
        systemInstructions: systemInstructions.trim() || null,
        styleRules: styleRules.trim() || null,
        forbiddenPhrases: forbiddenPhrases.trim() || null,
        preferredPhrases: preferredPhrases.trim() || null,
        exampleMessagesJson: JSON.stringify(exampleMessages.filter(e => e.trim())),
        knowledgeSummary: knowledgeSummary.trim() || null,
      };
      if (profile) {
        await apiRequest("PUT", `/api/ai/voice-profiles/${profile.id}`, payload);
      } else {
        await apiRequest("POST", "/api/ai/voice-profiles", { ...payload, profileType: "user" });
      }
      await qc.invalidateQueries({ queryKey: ["/api/ai/voice-profiles"] });
      toast({ title: profile ? "Profile updated" : "Profile created" });
      onSaved();
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddFile() {
    if (!profile || !newFileName.trim() || !newFileText.trim()) return;
    setAddingFile(true);
    try {
      const res = await apiRequest("POST", `/api/ai/voice-profiles/${profile.id}/files`, {
        originalFilename: newFileName.trim(),
        fileType: "text",
        extractedText: newFileText.trim(),
      });
      const file = await res.json();
      setFiles(prev => [...prev, file]);
      setNewFileName("");
      setNewFileText("");
      await qc.invalidateQueries({ queryKey: ["/api/ai/voice-profiles"] });
    } catch (err: any) {
      toast({ title: "Failed to add file", description: err.message, variant: "destructive" });
    } finally {
      setAddingFile(false);
    }
  }

  async function handleDeleteFile(fileId: number) {
    if (!profile) return;
    try {
      await apiRequest("DELETE", `/api/ai/voice-profiles/${profile.id}/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      await qc.invalidateQueries({ queryKey: ["/api/ai/voice-profiles"] });
    } catch (err: any) {
      toast({ title: "Failed to delete file", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            {profile ? "Edit Voice Profile" : "New Voice Profile"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-1">
          <TabsList className="grid w-full grid-cols-4 h-8 text-xs">
            <TabsTrigger value="basic" className="text-xs">Details</TabsTrigger>
            <TabsTrigger value="voice" className="text-xs">Voice</TabsTrigger>
            <TabsTrigger value="examples" className="text-xs">Examples</TabsTrigger>
            <TabsTrigger value="knowledge" className="text-xs">Knowledge</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. CEO Wattson"
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Who is this voice for? What's its purpose?"
                rows={2} className="text-sm resize-none"
                data-testid="input-profile-description"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source label <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={sourceLabel} onChange={e => setSourceLabel(e.target.value)}
                placeholder="e.g. CEO Wattson GPT"
                data-testid="input-profile-source-label"
              />
            </div>
          </TabsContent>

          <TabsContent value="voice" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">System instructions</Label>
              <p className="text-[11px] text-muted-foreground">Core writing voice — how should emails sound? Who is the author?</p>
              <Textarea
                value={systemInstructions} onChange={e => setSystemInstructions(e.target.value)}
                placeholder="Write like Trevor Burgess, CEO of VoltSafe. Direct, warm, no fluff…"
                rows={5} className="text-sm resize-none"
                data-testid="input-profile-system-instructions"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Style rules</Label>
              <p className="text-[11px] text-muted-foreground">One rule per line. Structure, length, and formatting guidelines.</p>
              <Textarea
                value={styleRules} onChange={e => setStyleRules(e.target.value)}
                placeholder={"- Short opening\n- Direct reason for the email\n- End with a simple next step"}
                rows={4} className="text-sm resize-none font-mono"
                data-testid="input-profile-style-rules"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-red-400">Forbidden phrases</Label>
                <p className="text-[11px] text-muted-foreground">One per line.</p>
                <Textarea
                  value={forbiddenPhrases} onChange={e => setForbiddenPhrases(e.target.value)}
                  placeholder={"I hope this email finds you well\nCircle back\nSynergy"}
                  rows={5} className="text-sm resize-none font-mono"
                  data-testid="input-profile-forbidden-phrases"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-green-400">Preferred phrases</Label>
                <p className="text-[11px] text-muted-foreground">One per line.</p>
                <Textarea
                  value={preferredPhrases} onChange={e => setPreferredPhrases(e.target.value)}
                  placeholder={"Quick note\nThe reason I'm reaching out\nA simple next step would be"}
                  rows={5} className="text-sm resize-none font-mono"
                  data-testid="input-profile-preferred-phrases"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="examples" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">Paste 3–10 example emails written in this voice. The AI uses them to match your style.</p>
            {exampleMessages.map((ex, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Example {i + 1}</Label>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setExampleMessages(prev => prev.filter((_, j) => j !== i))}
                    data-testid={`button-remove-example-${i}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <Textarea
                  value={ex}
                  onChange={e => setExampleMessages(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                  rows={4} className="text-sm resize-none"
                  data-testid={`input-example-${i}`}
                />
              </div>
            ))}
            {exampleMessages.length < 10 && (
              <Button
                variant="outline" size="sm"
                className="w-full"
                onClick={() => setExampleMessages(prev => [...prev, ""])}
                data-testid="button-add-example"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />Add example email
              </Button>
            )}
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Background knowledge</Label>
              <p className="text-[11px] text-muted-foreground">General context the AI should know about this voice / company / product.</p>
              <Textarea
                value={knowledgeSummary} onChange={e => setKnowledgeSummary(e.target.value)}
                placeholder="Trevor Burgess is CEO of VoltSafe, a marina electrification company…"
                rows={4} className="text-sm resize-none"
                data-testid="input-profile-knowledge-summary"
              />
            </div>

            {profile && (
              <div className="space-y-2">
                <Label className="text-xs">Knowledge files</Label>
                <p className="text-[11px] text-muted-foreground">Paste document text that the AI can reference when generating emails.</p>

                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-2 rounded border border-border/50 bg-muted/20 px-3 py-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs flex-1 truncate">{f.originalFilename}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {f.extractedText ? `${Math.round(f.extractedText.length / 1000)}k chars` : ""}
                    </span>
                    <Button
                      size="sm" variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDeleteFile(f.id)}
                      data-testid={`button-delete-file-${f.id}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}

                <div className="rounded-md border border-dashed border-border/60 p-3 space-y-2">
                  <Input
                    value={newFileName} onChange={e => setNewFileName(e.target.value)}
                    placeholder="File name (e.g. product-overview.txt)"
                    className="h-7 text-xs"
                    data-testid="input-new-file-name"
                  />
                  <Textarea
                    value={newFileText} onChange={e => setNewFileText(e.target.value)}
                    placeholder="Paste document text here…"
                    rows={3} className="text-sm resize-none"
                    data-testid="input-new-file-text"
                  />
                  <Button
                    size="sm" variant="outline"
                    disabled={!newFileName.trim() || !newFileText.trim() || addingFile}
                    onClick={handleAddFile}
                    data-testid="button-add-file"
                  >
                    {addingFile ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                    Add file
                  </Button>
                </div>
              </div>
            )}

            {!profile && (
              <p className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2">
                Save the profile first, then you can add knowledge files.
              </p>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-profile">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} data-testid="button-save-profile">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
            {profile ? "Save changes" : "Create profile"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Import From GPT Wizard ────────────────────────────────────────────────────

function ImportFromGptWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 5;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [examples, setExamples] = useState(["", "", ""]);
  const [forbiddenPhrases, setForbiddenPhrases] = useState("");
  const [preferredPhrases, setPreferredPhrases] = useState("");
  const [styleRules, setStyleRules] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setStep(1);
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/ai/voice-profiles/import-from-gpt", {
        name: name.trim(),
        description: description.trim() || null,
        sourceLabel: sourceLabel.trim() || "Imported from GPT",
        systemInstructions: systemInstructions.trim() || null,
        styleRules: styleRules.trim() || null,
        forbiddenPhrases: forbiddenPhrases.trim() || null,
        preferredPhrases: preferredPhrases.trim() || null,
        exampleMessages: examples.filter(e => e.trim()),
        knowledgeText: knowledgeText.trim() || null,
        profileType: "user",
      });
      await qc.invalidateQueries({ queryKey: ["/api/ai/voice-profiles"] });
      toast({ title: "Voice profile imported", description: `"${name.trim()}" is ready to use.` });
      onSaved();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const stepLabel = ["Profile details", "GPT instructions", "Knowledge", "Example emails", "Review & save"];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" />
            Import from GPT
            <span className="font-normal text-muted-foreground text-sm">— Step {step} of {TOTAL_STEPS}</span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
          {stepLabel[step - 1]}
        </p>

        <div className="flex gap-1 mb-3">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < step ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Profile name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CEO Wattson" data-testid="input-import-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder="What is this voice? Who does it represent?" rows={2} className="text-sm resize-none"
                data-testid="input-import-description" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source label</Label>
              <Input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)}
                placeholder="e.g. CEO Wattson GPT" data-testid="input-import-source-label" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Open your Custom GPT on ChatGPT → Settings → Configure. Copy the "Instructions" field and paste it below.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">GPT instructions</Label>
              <Textarea value={systemInstructions} onChange={e => setSystemInstructions(e.target.value)}
                placeholder="Paste your GPT's system instructions here…"
                rows={8} className="text-sm resize-none"
                data-testid="input-import-instructions" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Style rules <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={styleRules} onChange={e => setStyleRules(e.target.value)}
                  placeholder="One rule per line…" rows={3} className="text-sm resize-none font-mono"
                  data-testid="input-import-style-rules" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Forbidden phrases <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={forbiddenPhrases} onChange={e => setForbiddenPhrases(e.target.value)}
                  placeholder="One per line…" rows={3} className="text-sm resize-none font-mono"
                  data-testid="input-import-forbidden" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Preferred phrases <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea value={preferredPhrases} onChange={e => setPreferredPhrases(e.target.value)}
                placeholder="One per line…" rows={2} className="text-sm resize-none font-mono"
                data-testid="input-import-preferred" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Copy any knowledge documents from your GPT (product docs, FAQ, company background) and paste them below.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Knowledge document text</Label>
              <Textarea value={knowledgeText} onChange={e => setKnowledgeText(e.target.value)}
                placeholder="Paste document text here…"
                rows={10} className="text-sm resize-none"
                data-testid="input-import-knowledge" />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste 3–10 example emails written in this voice. The AI will use them to match your style.
            </p>
            {examples.map((ex, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Example {i + 1}</Label>
                  {examples.length > 1 && (
                    <Button size="sm" variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setExamples(prev => prev.filter((_, j) => j !== i))}
                      data-testid={`button-remove-import-example-${i}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Textarea value={ex} onChange={e => setExamples(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                  rows={3} className="text-sm resize-none" data-testid={`input-import-example-${i}`} />
              </div>
            ))}
            {examples.length < 10 && (
              <Button variant="outline" size="sm" className="w-full"
                onClick={() => setExamples(prev => [...prev, ""])}
                data-testid="button-add-import-example">
                <Plus className="h-3.5 w-3.5 mr-1.5" />Add example
              </Button>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2 text-sm">
              <ReviewRow label="Name" value={name || "—"} />
              <ReviewRow label="Description" value={description || "—"} />
              <ReviewRow label="Source" value={sourceLabel || "—"} />
              <ReviewRow label="Instructions" value={systemInstructions ? `${systemInstructions.slice(0, 100)}…` : "—"} />
              <ReviewRow label="Knowledge" value={knowledgeText ? `${Math.round(knowledgeText.length / 1000)}k chars` : "—"} />
              <ReviewRow label="Examples" value={`${examples.filter(e => e.trim()).length} provided`} />
            </div>
            {!name.trim() && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/8 border border-amber-500/20 p-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">Profile name is required. Go back to Step 1.</p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
            data-testid="button-wizard-back">
            {step === 1 ? <><X className="h-3.5 w-3.5 mr-1.5" />Cancel</> : <><ChevronLeft className="h-3.5 w-3.5 mr-1.5" />Back</>}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button size="sm" onClick={() => setStep(s => s + 1)} data-testid="button-wizard-next">
              Next <ChevronRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()} data-testid="button-wizard-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              Save voice profile
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="text-xs text-foreground/80 flex-1 break-words">{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiVoiceProfilesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: profiles = [], isLoading } = useQuery<VoiceProfile[]>({
    queryKey: ["/api/ai/voice-profiles"],
  });

  const { data: aiSettings } = useQuery<{ defaultVoiceProfileId: number | null; ceoWattsonInfluenceLevel: number }>({
    queryKey: ["/api/ai/settings"],
  });

  const [editingProfile, setEditingProfile] = useState<VoiceProfile | null | "new">(null);
  const [showImport, setShowImport] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const setDefaultMutation = useMutation({
    mutationFn: (id: number | null) =>
      apiRequest("PUT", "/api/ai/settings/default-voice-profile", { voiceProfileId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "Default voice profile updated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const setInfluenceMutation = useMutation({
    mutationFn: (level: number) =>
      apiRequest("PATCH", "/api/ai/settings/wattson-influence", { influenceLevel: level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      toast({ title: "CEO Wattson influence updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update influence", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ai/voice-profiles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/voice-profiles"] });
      toast({ title: "Profile deleted" });
      setDeletingId(null);
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const defaultId = aiSettings?.defaultVoiceProfileId;
  const globalProfiles = profiles.filter(p => p.profileType === "global");
  const userProfiles = profiles.filter(p => p.profileType === "user");

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-background">
      <div className="max-w-3xl w-full mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              AI Voice Profiles
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Recreate any ChatGPT Custom GPT voice inside VoltSafe. The AI uses your selected voice when generating emails.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline" size="sm"
              onClick={() => setShowImport(true)}
              data-testid="button-import-from-gpt"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />Import from GPT
            </Button>
            <Button
              size="sm"
              onClick={() => setEditingProfile("new")}
              data-testid="button-new-voice-profile"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />New profile
            </Button>
          </div>
        </div>

        {/* Help callout */}
        <div className="rounded-md bg-primary/5 border border-primary/15 px-4 py-3">
          <p className="text-xs text-foreground/80">
            <span className="font-semibold text-primary">How it works:</span>{" "}
            Copy your Custom GPT's instructions, example emails, and knowledge docs into a Voice Profile.
            Then select it in the "Suggested Next Email" panel — the AI generates emails in that exact voice.
          </p>
        </div>

        {/* CEO Wattson Influence control */}
        <div className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary shrink-0" />
            <h2 className="text-sm font-semibold">CEO Wattson Influence</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Controls how strongly VoltSafe AI upgrades your writing toward the CEO Wattson executive style
            instead of copying your raw historical email tone.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {[
              { value: 0,   label: "Natural Voice",    desc: "Your natural voice, minimal changes" },
              { value: 25,  label: "Light Polish",     desc: "Light editing, preserves personality" },
              { value: 50,  label: "Executive Polish", desc: "Balanced — clarity + personality" },
              { value: 75,  label: "CEO Wattson",      desc: "Executive style dominates" },
              { value: 100, label: "Full CEO Wattson", desc: "Maximum executive rewrite" },
            ].map(opt => {
              const active = (aiSettings?.ceoWattsonInfluenceLevel ?? 75) === opt.value;
              return (
                <button
                  key={opt.value}
                  data-testid={`button-influence-${opt.value}`}
                  onClick={() => setInfluenceMutation.mutate(opt.value)}
                  disabled={setInfluenceMutation.isPending}
                  className={cn(
                    "rounded-md border px-2 py-2.5 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/50 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40"
                  )}
                >
                  <p className={cn("text-xs font-medium", active && "text-primary")}>{opt.label}</p>
                  <p className="text-[10px] mt-0.5 leading-snug">{opt.desc}</p>
                </button>
              );
            })}
          </div>
          {setInfluenceMutation.isPending && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />Saving…
            </p>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading profiles…
          </div>
        )}

        {/* Global profiles */}
        {globalProfiles.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Built-in profiles
            </h2>
            {globalProfiles.map(p => (
              <ProfileCard
                key={p.id}
                profile={p}
                isDefault={defaultId === p.id || (defaultId === null && p.isDefault)}
                onEdit={() => setEditingProfile(p)}
                onDelete={() => setDeletingId(p.id)}
                onSetDefault={() => setDefaultMutation.mutate(p.id)}
              />
            ))}
          </div>
        )}

        {/* User profiles */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            My profiles
          </h2>
          {userProfiles.length === 0 && !isLoading && (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center space-y-2">
              <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No custom profiles yet.</p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowImport(true)} data-testid="button-empty-import">
                  <Download className="h-3.5 w-3.5 mr-1.5" />Import from GPT
                </Button>
                <Button size="sm" onClick={() => setEditingProfile("new")} data-testid="button-empty-new">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />Create profile
                </Button>
              </div>
            </div>
          )}
          {userProfiles.map(p => (
            <ProfileCard
              key={p.id}
              profile={p}
              isDefault={defaultId === p.id}
              onEdit={() => setEditingProfile(p)}
              onDelete={() => setDeletingId(p.id)}
              onSetDefault={() => setDefaultMutation.mutate(p.id)}
            />
          ))}
        </div>
      </div>

      {/* Edit / Create dialog */}
      {editingProfile !== null && (
        <ProfileEditDialog
          profile={editingProfile === "new" ? null : editingProfile}
          onClose={() => setEditingProfile(null)}
          onSaved={() => setEditingProfile(null)}
        />
      )}

      {/* Import wizard */}
      {showImport && (
        <ImportFromGptWizard
          onClose={() => setShowImport(false)}
          onSaved={() => setShowImport(false)}
        />
      )}

      {/* Delete confirmation */}
      {deletingId !== null && (
        <Dialog open onOpenChange={() => setDeletingId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Delete voice profile?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will permanently remove the profile and all its knowledge files.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>Cancel</Button>
              <Button
                variant="destructive" size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingId)}
                data-testid="button-confirm-delete-profile"
              >
                {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
