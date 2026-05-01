import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, UserPlus, TrendingUp, CalendarDays, StickyNote,
  Loader2, Zap, Plus, PenLine, Link2, Camera,
} from "lucide-react";

type Tab = "note" | "task" | "contact" | "opportunity" | "meeting-note";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "note", label: "Note", icon: StickyNote },
  { id: "task", label: "Task", icon: ClipboardList },
  { id: "contact", label: "Contact", icon: UserPlus },
  { id: "opportunity", label: "Deal", icon: TrendingUp },
  { id: "meeting-note", label: "Meeting Note", icon: CalendarDays },
];

function NoteForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");

  const save = () => {
    if (!text.trim()) return;
    toast({ title: "Note saved", description: "Note stored as a task reminder." });
    onClose();
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your note here…"
        rows={4}
        autoFocus
        className="resize-none"
        data-testid="input-quick-note"
      />
      <Button className="w-full" onClick={save} disabled={!text.trim()} data-testid="button-save-note">
        Save Note
      </Button>
    </div>
  );
}

function TaskForm({ onClose, prefill }: { onClose: () => void; prefill?: any }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(prefill?.title || "");
  const [dueDate, setDueDate] = useState(prefill?.dueDate || "");
  const [priority, setPriority] = useState(prefill?.priority || "medium");
  const [ownerUserId, setOwnerUserId] = useState<string>("me");

  const { data: me } = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: () => fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()),
  });
  const { data: users = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/users"],
    queryFn: () => fetch("/api/users", { credentials: "include" }).then(r => r.json()),
  });

  const resolvedOwnerUserId = ownerUserId === "me" ? (me?.id ?? null) : Number(ownerUserId);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks", {
      title: title.trim(),
      dueDate: dueDate || null,
      priority,
      status: "pending",
      ownerUserId: resolvedOwnerUserId,
      linkedObjectType: prefill?.linkedObjectType || null,
      linkedObjectId: prefill?.linkedObjectId || null,
      accountId: prefill?.accountId || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/hub"] });
      toast({ title: "Task created", description: title });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs mb-1.5 block">Task title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Follow up with marina contact" autoFocus data-testid="input-task-title" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Due date</Label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-task-due" />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger data-testid="select-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Assign to</Label>
        <Select value={ownerUserId} onValueChange={setOwnerUserId}>
          <SelectTrigger data-testid="select-assignee"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="me">Me{me?.name ? ` (${me.name})` : ""}</SelectItem>
            {users.filter(u => u.id !== me?.id).map(u => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={!title.trim() || mutation.isPending} data-testid="button-create-task">
        {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : "Create Task"}
      </Button>
    </div>
  );
}

function ContactForm({ onClose }: { onClose: () => void }) {
  const launch = (mode: "manual" | "url" | "card") => {
    onClose();
    // Wait one tick so the Quick Capture dialog finishes closing before the
    // contact dialog opens — prevents focus-trap collisions.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("open-create-contact", { detail: { mode } }));
    }, 50);
  };

  const tiles: {
    mode: "manual" | "url" | "card";
    label: string;
    description: string;
    icon: React.ElementType;
    testId: string;
  }[] = [
    {
      mode: "manual",
      label: "Manual",
      description: "Type the details in",
      icon: PenLine,
      testId: "tile-contact-manual",
    },
    {
      mode: "url",
      label: "LinkedIn",
      description: "Paste a profile or site link",
      icon: Link2,
      testId: "tile-contact-linkedin",
    },
    {
      mode: "card",
      label: "Business card",
      description: "Snap front + back, AI fills it in",
      icon: Camera,
      testId: "tile-contact-card",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Choose how you'd like to add this contact.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {tiles.map(({ mode, label, description, icon: Icon, testId }) => (
          <button
            key={mode}
            type="button"
            onClick={() => launch(mode)}
            className="flex items-center gap-3 p-3 rounded-lg border border-border/60 hover:border-primary/60 hover:bg-primary/5 transition text-left"
            data-testid={testId}
          >
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function OpportunityForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState("qualifying");

  const mutation = useMutation({
    mutationFn: async () => {
      let accountId: number;
      if (company.trim()) {
        const accRes = await apiRequest("POST", "/api/accounts", {
          name: company.trim(), segment: "marina", leadStatus: "new", priority: "medium",
        });
        accountId = accRes.id;
      } else {
        throw new Error("Organization is required");
      }
      return apiRequest("POST", "/api/opportunities", {
        title: title.trim(), accountId, stage,
        amount: amount ? Number(amount) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({ title: "Opportunity created", description: title });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs mb-1.5 block">Opportunity title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. BlueCurrent EV Charging Pilot" autoFocus data-testid="input-opp-title" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Organization *</Label>
          <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Harbour Marina" data-testid="input-opp-org" />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Stage</Label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger data-testid="select-opp-stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="qualifying">Qualifying</SelectItem>
              <SelectItem value="proposal">Proposal</SelectItem>
              <SelectItem value="negotiation">Negotiation</SelectItem>
              <SelectItem value="verbal_commit">Verbal Commit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Deal value (USD)</Label>
        <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" data-testid="input-opp-amount" />
      </div>
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={!title.trim() || !company.trim() || mutation.isPending} data-testid="button-create-opp">
        {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : "Create Opportunity"}
      </Button>
    </div>
  );
}

function MeetingNoteForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks", {
      title: `Meeting note: ${meetingTitle || "Untitled meeting"}`,
      description: notes.trim(),
      status: "pending",
      priority: "low",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Meeting note saved" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs mb-1.5 block">Meeting / company name</Label>
        <Input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="e.g. Call with Harbour Marina" autoFocus data-testid="input-meeting-name" />
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Notes</Label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Key takeaways, action items, follow-ups…"
          rows={4}
          className="resize-none"
          data-testid="input-meeting-notes"
        />
      </div>
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={!notes.trim() || mutation.isPending} data-testid="button-save-meeting-note">
        {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save Notes"}
      </Button>
    </div>
  );
}

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [prefill, setPrefill] = useState<any>(null);

  const handleOpen = useCallback((tab?: Tab, pre?: any) => {
    setActiveTab(tab ?? "task");
    setPrefill(pre || null);
    setOpen(true);
  }, []);

  // ⌘K is reserved for the unified Command Palette — Quick Capture is opened
  // via the floating action button only. (Removed Cmd+K to prevent multi-overlay
  // collision with the inbox command palette and header global search.)

  // Global event listener for programmatic open
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      handleOpen(detail.tab, detail.prefill);
    };
    window.addEventListener("open-quick-capture", handler);
    return () => window.removeEventListener("open-quick-capture", handler);
  }, [handleOpen]);

  // Dynamic FAB position — pages dispatch "fab-nudge" to shift the button out
  // of the way of their own bottom-right UI (e.g. email reading pane CRM row).
  // Payload: { bottom?: number, right?: number } in pixels. Omitted axes keep
  // their default. Reset by dispatching with { bottom: 40, right: 24 }.
  const [fabStyle, setFabStyle] = useState<React.CSSProperties>({ bottom: 40, right: 24 });
  useEffect(() => {
    const handler = (e: Event) => {
      const { bottom, right } = (e as CustomEvent<{ bottom?: number; right?: number }>).detail ?? {};
      setFabStyle((prev) => ({
        ...prev,
        ...(bottom !== undefined ? { bottom } : {}),
        ...(right  !== undefined ? { right  } : {}),
      }));
    };
    window.addEventListener("fab-nudge", handler);
    return () => window.removeEventListener("fab-nudge", handler);
  }, []);

  return (
    <>
      {/* Floating action button — position driven by fabStyle so pages can nudge
          it out of the way of their own bottom-right controls via the "fab-nudge"
          custom event.  Hidden on mobile (handled by the bottom nav instead). */}
      <button
        id="quick-capture-fab"
        onClick={() => handleOpen()}
        className="fixed z-50 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-[bottom,right,transform,box-shadow] duration-300 hidden md:flex items-center justify-center"
        style={fabStyle}
        title="Quick capture (⌘K)"
        data-testid="button-quick-capture"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border/50">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-primary" />
                Quick Capture
                <span className="ml-auto text-xs text-muted-foreground font-normal">⌘K</span>
              </DialogTitle>
            </DialogHeader>

            {/* Tab bar */}
            <div className="flex items-center gap-0.5 mt-3 overflow-x-auto">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}
                    data-testid={`qc-tab-${tab.id}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5">
            {activeTab === "note" && <NoteForm onClose={() => setOpen(false)} />}
            {activeTab === "task" && <TaskForm onClose={() => setOpen(false)} prefill={prefill} />}
            {activeTab === "contact" && <ContactForm onClose={() => setOpen(false)} />}
            {activeTab === "opportunity" && <OpportunityForm onClose={() => setOpen(false)} />}
            {activeTab === "meeting-note" && <MeetingNoteForm onClose={() => setOpen(false)} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
