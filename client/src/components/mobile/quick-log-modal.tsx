import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { StickyNote, Phone, MapPin, ArrowRight, Loader2, X } from "lucide-react";

type LogType = "note" | "call" | "visit" | "next_step";

const LOG_TYPES: { id: LogType; label: string; icon: React.ElementType; placeholder: string }[] = [
  { id: "note", label: "Note", icon: StickyNote, placeholder: "Add a note about this record…" },
  { id: "call", label: "Call", icon: Phone, placeholder: "What happened on the call? Outcome, next steps…" },
  { id: "visit", label: "Visit", icon: MapPin, placeholder: "Site visit summary. What did you see?" },
  { id: "next_step", label: "Next Step", icon: ArrowRight, placeholder: "What's the next action to take?" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  linkedObjectType?: string;
  linkedObjectId?: number;
  linkedLabel?: string;
};

export function QuickLogModal({ open, onClose, linkedObjectType, linkedObjectId, linkedLabel }: Props) {
  const { toast } = useToast();
  const [type, setType] = useState<LogType>("note");
  const [content, setContent] = useState("");

  const selected = LOG_TYPES.find(t => t.id === type)!;

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/notes", {
        content: `[${selected.label}] ${content.trim()}`,
        linkedObjectType: linkedObjectType ?? "general",
        linkedObjectId: linkedObjectId ?? 0,
      }),
    onSuccess: () => {
      toast({ title: `${selected.label} logged`, description: linkedLabel ?? "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      setContent("");
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!content.trim()) return;
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md rounded-2xl p-0 overflow-hidden" data-testid="quick-log-modal">
        <DialogHeader className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold">
              Quick Log{linkedLabel ? ` — ${linkedLabel}` : ""}
            </DialogTitle>
            <button
              onClick={onClose}
              className="p-1 rounded-full text-muted-foreground hover:text-foreground"
              data-testid="button-quick-log-close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 pt-4">
          <div className="flex gap-2 mb-4" data-testid="quick-log-type-tabs">
            {LOG_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  type === t.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
                }`}
                data-testid={`quick-log-type-${t.id}`}
              >
                <t.icon className="w-3 h-3" />
                {t.label}
              </button>
            ))}
          </div>

          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={selected.placeholder}
            rows={5}
            autoFocus
            className="resize-none text-sm"
            data-testid="quick-log-content"
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
            }}
          />
          <p className="text-[10px] text-muted-foreground mt-1">⌘+Enter to save</p>
        </div>

        <div className="px-5 py-4">
          <Button
            className="w-full h-11 text-sm font-medium"
            onClick={handleSave}
            disabled={!content.trim() || save.isPending}
            data-testid="button-quick-log-save"
          >
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save {selected.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
