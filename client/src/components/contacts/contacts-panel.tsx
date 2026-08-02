import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X, Mail, Phone, StickyNote, Pencil, Check, Search, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ContactAvatar } from "./contact-avatar";
import { CreateContactDialog } from "./create-contact-dialog";

export type EntityType = "opportunity" | "account" | "lead";

const PATH: Record<EntityType, string> = {
  opportunity: "opportunities",
  account: "accounts",
  lead: "leads",
};

type ContactRow = {
  id: number;
  contactId: number;
  role: string | null;
  contact: {
    id: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    notes?: string | null;
    avatarUrl?: string | null;
  };
};

export function ContactsPanel({
  entityType,
  entityId,
  canEdit = true,
  emptyText,
}: {
  entityType: EntityType;
  entityId: number;
  canEdit?: boolean;
  emptyText?: string;
}) {
  const { toast } = useToast();
  const base = `/api/${PATH[entityType]}/${entityId}/contacts`;
  const queryKey = [base];

  const { data: rows = [], isLoading } = useQuery<ContactRow[]>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(base, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load contacts");
      return r.json();
    },
    enabled: !!entityId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.refetchQueries({ queryKey, type: "active" });
    // Profile, record card, and list — all may display the contact count
    queryClient.invalidateQueries({ queryKey: [`/api/${PATH[entityType]}`, entityId, "profile"] });
    queryClient.invalidateQueries({ queryKey: [`/api/${PATH[entityType]}`, entityId] });
    queryClient.invalidateQueries({ queryKey: [`/api/${PATH[entityType]}`] });
  };

  const removeMut = useMutation({
    mutationFn: (contactId: number) => apiRequest("DELETE", `${base}/${contactId}`),
    onSuccess: invalidate,
    onError: () => toast({ title: "Could not remove contact", variant: "destructive" }),
  });

  return (
    <div className="space-y-2" data-testid={`contacts-panel-${entityType}-${entityId}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "contact" : "contacts"}</span>
        {canEdit && !!entityId && entityId > 0 && (
          <AddContactPopover entityType={entityType} entityId={entityId} alreadyLinked={rows.map(r => r.contactId)} onAdded={invalidate} />
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-2">{emptyText || "No contacts linked yet."}</div>
      ) : (
        <div className="space-y-1">
          {rows.map(r => (
            <ContactRowItem
              key={`${r.contactId}-${r.id}`}
              row={r}
              canEdit={canEdit}
              onRemove={() => removeMut.mutate(r.contactId)}
              base={base}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContactRowItem({
  row,
  canEdit,
  onRemove,
  base,
  onChanged,
}: {
  row: ContactRow;
  canEdit: boolean;
  onRemove: () => void;
  base: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = row.contact || ({} as any);
  return (
    <div
      className="group flex items-start gap-2.5 p-2 rounded hover:bg-muted/40 transition-colors"
      data-testid={`row-contact-${c.id}`}
    >
      <ContactAvatar name={c.name} avatarUrl={c.avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/contacts/${c.id}`}>
            <span className="text-sm font-medium hover:underline cursor-pointer truncate" data-testid={`text-contact-name-${c.id}`}>
              {c.name || "Unnamed"}
            </span>
          </Link>
          {(row.role || c.title) && (
            <span className="text-xs text-muted-foreground truncate">· {row.role || c.title}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          {c.email && (
            <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-foreground truncate" data-testid={`link-email-${c.id}`}>
              <Mail className="h-3 w-3" /> <span className="truncate">{c.email}</span>
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-foreground" data-testid={`link-phone-${c.id}`}>
              <Phone className="h-3 w-3" /> {c.phone}
            </a>
          )}
        </div>
        {c.notes && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2" data-testid={`text-notes-${c.id}`}>
            <StickyNote className="h-3 w-3 inline mr-1" />{c.notes}
          </div>
        )}
        {open && canEdit && (
          <ContactInlineEditor row={row} base={base} onSaved={() => { setOpen(false); onChanged(); }} />
        )}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpen(v => !v)} data-testid={`button-edit-contact-${c.id}`} title="Edit role / details">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onRemove} data-testid={`button-remove-contact-${c.id}`} title="Remove from this record">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ContactInlineEditor({ row, base, onSaved }: { row: ContactRow; base: string; onSaved: () => void }) {
  const c = row.contact;
  const [role, setRole] = useState(row.role || "");
  const [title, setTitle] = useState(c.title || "");
  const [notes, setNotes] = useState(c.notes || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `${base}/${c.id}`, { role: role || null });
      await apiRequest("PUT", `/api/contacts/${c.id}`, { title: title || null, notes: notes || null });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", c.id, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 p-2 border rounded bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground tracking-wide">Role on this record</label>
          <Input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Decision maker" className="h-8 text-xs" data-testid={`input-role-${c.id}`} />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground tracking-wide">Job title</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Marina Manager" className="h-8 text-xs" data-testid={`input-title-${c.id}`} />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground tracking-wide">Notes</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Personal notes, preferences, context…" className="h-8 text-xs" data-testid={`input-notes-${c.id}`} />
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onSaved}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving} data-testid={`button-save-contact-${c.id}`}>
          <Check className="h-3 w-3 mr-1" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function AddContactPopover({
  entityType,
  entityId,
  alreadyLinked,
  onAdded,
}: {
  entityType: EntityType;
  entityId: number;
  alreadyLinked: number[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [resolvedAccountId, setResolvedAccountId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<any[]>({
    queryKey: ["/api/contacts", { search }],
    queryFn: async () => {
      const r = await fetch(`/api/contacts?search=${encodeURIComponent(search)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to search contacts");
      return r.json();
    },
    enabled: open,
    staleTime: 10_000,
  });

  const linkedSet = useMemo(() => new Set(alreadyLinked), [alreadyLinked]);
  const filtered = Array.isArray(contacts) ? contacts.filter((c: any) => !linkedSet.has(c.id)) : [];
  const base = `/api/${PATH[entityType]}/${entityId}/contacts`;

  // Guard: never fire a request with an invalid entity ID (0, NaN, undefined)
  const entityIdValid = !!entityId && entityId > 0 && !isNaN(entityId);

  const link = useMutation({
    mutationFn: async (contactId: number) => {
      if (!entityIdValid) throw new Error("Parent record ID is not yet available — please wait and try again.");
      const r = await apiRequest("POST", base, { contactId });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${r.status}`);
      }
      return r.json() as Promise<{ created: boolean; alreadyLinked: boolean; id: number; contactId: number }>;
    },
    onSuccess: async (data) => {
      // Refetch the authoritative list and verify the contact is present
      // before showing success — never toast on mutation callback alone.
      await queryClient.invalidateQueries({ queryKey: [base] });
      let confirmed = data.alreadyLinked;
      if (!confirmed) {
        try {
          const list = await queryClient.fetchQuery<ContactRow[]>({
            queryKey: [base],
            queryFn: async () => {
              const r = await fetch(base, { credentials: "include" });
              if (!r.ok) throw new Error("Failed to load contacts");
              return r.json();
            },
            staleTime: 0,
          });
          confirmed = Array.isArray(list) && list.some(r => r.contactId === data.contactId);
        } catch {
          confirmed = false;
        }
      }
      if (confirmed || data.alreadyLinked) {
        toast({
          title: data.alreadyLinked ? "Already linked" : "Contact linked",
          description: data.alreadyLinked
            ? "This contact is already on this record."
            : "Contact added to this record.",
        });
      } else {
        toast({ title: "Link may not have saved — please refresh", variant: "destructive" });
      }
      onAdded();
      setOpen(false);
      setSearch("");
    },
    onError: (err: any) => toast({
      title: "Could not link contact",
      description: err?.message ?? "Please try again.",
      variant: "destructive",
    }),
  });

  const openCreateDialog = () => {
    // Close the popover synchronously first — this stops any concurrent
    // TanStack Query fetches from running alongside the async account lookup,
    // preventing setState collisions that cause React error #310.
    setOpen(false);

    if (entityType === "account") {
      setResolvedAccountId(entityId);
      setCreateOpen(true);
      return;
    }

    // For leads / opportunities: try to resolve the linked account id in the
    // background and pass it to the dialog.  If the record has no account yet
    // (or the fetch fails) we still open the dialog — CreateContactDialog
    // has its own org picker so the user can choose or create one inline.
    setResolvedAccountId(null);
    setCreateOpen(true);

    (async () => {
      try {
        const parentPath = entityType === "opportunity" ? "opportunities" : "leads";
        const r = await fetch(`/api/${parentPath}/${entityId}`, { credentials: "include" }).then(x => x.json());
        const found = r?.accountId ?? r?.account_id ?? null;
        if (found) setResolvedAccountId(found);
      } catch {}
    })();
  };

  const onContactCreated = async (created: any) => {
    try {
      if (!(entityType === "account" && created.accountId === entityId)) {
        await apiRequest("POST", base, { contactId: created.id });
      }
    } catch (e: any) {
      toast({ title: "Created, but couldn't link", description: e.message, variant: "destructive" });
    }
    onAdded();
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            data-testid={`button-add-contact-${entityType}`}
            disabled={!entityIdValid}
            title={!entityIdValid ? "Loading record…" : undefined}
          >
            <Plus className="h-3.5 w-3.5" /> Add contact
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="end">
          {/* Search input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              placeholder="Search contacts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
              data-testid="input-search-contact"
            />
          </div>

          {/* New Contact */}
          <button
            onClick={() => openCreateDialog()}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-primary font-medium hover:bg-accent transition-colors mb-1"
            data-testid="option-create-new-contact"
          >
            <Plus className="h-3.5 w-3.5" /> New Contact
          </button>

          {/* Existing contacts list */}
          <div className="border-t border-border/40 pt-1 mt-1">
            <p className="px-2 pb-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Link existing</p>
            {contactsLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching…
              </div>
            ) : filtered.length > 0 ? (
              <div className="max-h-[220px] overflow-y-auto space-y-0.5">
                {filtered.slice(0, 15).map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => link.mutate(c.id)}
                    disabled={link.isPending}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent transition-colors text-left disabled:opacity-50"
                    data-testid={`option-contact-${c.id}`}
                  >
                    <ContactAvatar name={c.name} avatarUrl={c.avatarUrl} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{c.email || c.title || "—"}</div>
                    </div>
                    {link.isPending && <Loader2 className="h-3 w-3 animate-spin flex-shrink-0 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            ) : search.length > 0 ? (
              <p className="py-3 text-xs text-center text-muted-foreground">No contacts found for "{search}"</p>
            ) : (
              <p className="py-3 text-xs text-center text-muted-foreground">
                {Array.isArray(contacts) && contacts.length > 0 ? "All contacts already linked." : "No other contacts yet."}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <CreateContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={resolvedAccountId}
        onCreated={onContactCreated}
      />
    </>
  );
}
