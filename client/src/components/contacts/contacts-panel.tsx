import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, X, Mail, Phone, Briefcase, StickyNote, Pencil, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ContactAvatar } from "./contact-avatar";

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
    queryClient.invalidateQueries({ queryKey: [`/api/${PATH[entityType]}`, entityId, "profile"] });
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
        {canEdit && (
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
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const { toast } = useToast();

  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/contacts", { search }],
    queryFn: async () => {
      const r = await fetch(`/api/contacts?search=${encodeURIComponent(search)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to search contacts");
      return r.json();
    },
    enabled: open,
  });

  const linkedSet = useMemo(() => new Set(alreadyLinked), [alreadyLinked]);
  const filtered = contacts.filter((c: any) => !linkedSet.has(c.id));
  const base = `/api/${PATH[entityType]}/${entityId}/contacts`;

  const link = useMutation({
    mutationFn: (contactId: number) => apiRequest("POST", base, { contactId }),
    onSuccess: () => { onAdded(); setOpen(false); setSearch(""); },
    onError: () => toast({ title: "Could not link contact", variant: "destructive" }),
  });

  const createAndLink = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // For accounts, we have an entity-level account id we can use as the
      // primary home. For opportunities/leads we'd need the related accountId,
      // so we ask the user to create the contact from the account page first
      // unless they're on an account.
      let primaryAccountId = entityType === "account" ? entityId : null;
      if (!primaryAccountId) {
        // Try to derive the account id from the parent record.
        try {
          const parentPath = entityType === "opportunity" ? "opportunities" : "leads";
          const r = await fetch(`/api/${parentPath}/${entityId}`, { credentials: "include" }).then(x => x.json());
          primaryAccountId = r?.accountId ?? r?.account_id ?? null;
        } catch {}
      }
      if (!primaryAccountId) {
        toast({ title: "Can't create contact here", description: "Open the related account/marina to create a brand new contact.", variant: "destructive" });
        return;
      }
      const created = await apiRequest("POST", "/api/contacts", {
        accountId: primaryAccountId,
        name: newName.trim(),
        email: newEmail.trim() || null,
        title: newTitle.trim() || null,
      }).then((r: any) => r.json());
      if (entityType === "account" && created.accountId === entityId) {
        // Already linked via primary; just refresh.
        onAdded();
      } else {
        await apiRequest("POST", base, { contactId: created.id });
      }
      setOpen(false);
      setNewName(""); setNewEmail(""); setNewTitle("");
      onAdded();
    } catch (e: any) {
      toast({ title: "Couldn't create contact", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid={`button-add-contact-${entityType}`}>
          <Plus className="h-3.5 w-3.5" /> Add contact
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {!creating ? (
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search contacts…" value={search} onValueChange={setSearch} data-testid="input-search-contact" />
            <CommandList>
              <CommandEmpty>
                <div className="py-2 text-xs">No matches</div>
              </CommandEmpty>
              <CommandGroup heading="Existing">
                {filtered.slice(0, 15).map((c: any) => (
                  <CommandItem key={c.id} value={String(c.id)} onSelect={() => link.mutate(c.id)} data-testid={`option-contact-${c.id}`}>
                    <div className="flex items-center gap-2 w-full">
                      <ContactAvatar name={c.name} avatarUrl={c.avatarUrl} size="xs" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{c.email || c.title || "—"}</div>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Or">
                <CommandItem onSelect={() => setCreating(true)} data-testid="option-create-new-contact">
                  <Plus className="h-3 w-3 mr-2" /> Create new contact
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="p-3 space-y-2">
            <div className="text-xs font-semibold mb-1">New contact</div>
            <Input placeholder="Full name *" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs" data-testid="input-new-name" />
            <Input placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="h-8 text-xs" data-testid="input-new-email" />
            <Input placeholder="Job title" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="h-8 text-xs" data-testid="input-new-title" />
            <div className="flex gap-1.5 justify-end pt-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>Back</Button>
              <Button size="sm" className="h-7 text-xs" onClick={createAndLink} disabled={!newName.trim()} data-testid="button-create-link-contact">
                Create &amp; link
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
