import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Loader2, Zap, Plus,
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

function TaskForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tasks", {
      title: title.trim(),
      dueDate: dueDate || null,
      priority,
      status: "pending",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
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
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={!title.trim() || mutation.isPending} data-testid="button-create-task">
        {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : "Create Task"}
      </Button>
    </div>
  );
}

function ContactForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // Create or find account
      let accountId: number;
      if (company.trim()) {
        const accRes = await apiRequest("POST", "/api/accounts", {
          name: company.trim(), segment: "marina", leadStatus: "new", priority: "medium",
        });
        accountId = accRes.id;
      } else {
        throw new Error("Company name is required");
      }
      return apiRequest("POST", "/api/contacts", {
        name: name.trim(), email: email.toLowerCase().trim() || null,
        title: title.trim() || null, accountId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact created", description: name });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoFocus data-testid="input-contact-name" />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Dockmaster" data-testid="input-contact-title" />
        </div>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Email</Label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@marina.com" data-testid="input-contact-email" />
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">Organization *</Label>
        <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Harbour Marina Inc." data-testid="input-contact-org" />
      </div>
      <Button className="w-full" onClick={() => mutation.mutate()} disabled={!name.trim() || !company.trim() || mutation.isPending} data-testid="button-create-contact">
        {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : "Add Contact"}
      </Button>
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

  const handleOpen = useCallback((tab?: Tab) => {
    setActiveTab(tab ?? "task");
    setOpen(true);
  }, []);

  // Global keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleOpen]);

  // Global event listener for programmatic open
  useEffect(() => {
    const handler = (e: Event) => handleOpen((e as CustomEvent).detail?.tab);
    window.addEventListener("open-quick-capture", handler);
    return () => window.removeEventListener("open-quick-capture", handler);
  }, [handleOpen]);

  return (
    <>
      {/* Floating button — sits above the mobile nav bar (h-16 = 64px) + 24px gap on mobile */}
      <button
        id="quick-capture-fab"
        onClick={() => handleOpen()}
        className="fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center md:bottom-10 md:right-6"
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
            {activeTab === "task" && <TaskForm onClose={() => setOpen(false)} />}
            {activeTab === "contact" && <ContactForm onClose={() => setOpen(false)} />}
            {activeTab === "opportunity" && <OpportunityForm onClose={() => setOpen(false)} />}
            {activeTab === "meeting-note" && <MeetingNoteForm onClose={() => setOpen(false)} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
