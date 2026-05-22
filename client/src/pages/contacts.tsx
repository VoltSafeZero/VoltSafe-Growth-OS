import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Building2, Mail, Phone, Search, UserCircle2, Tag, ClipboardList, UserPlus, MoreHorizontal, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SavedViewsBar } from "@/components/saved-views-bar";
import { BulkActionsBar, BulkCheckbox } from "@/components/bulk-actions-bar";
import { CreateContactDialog } from "@/components/contacts/create-contact-dialog";
import type { Contact, Account, SavedView } from "@shared/schema";

type ContactWithAccount = Contact & { accountName?: string };

export default function ContactsPage({ canEdit = true }: { canEdit?: boolean }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [relationshipFilter, setRelationshipFilter] = useState("all");
  const [roleTypeFilter, setRoleTypeFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"name_asc" | "name_desc">("name_asc");
  const [highlightedContactId, setHighlightedContactId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [createContactOpen, setCreateContactOpen] = useState(false);

  // Bulk task form state
  const [bulkTaskTitle, setBulkTaskTitle] = useState("");
  const [showTaskInput, setShowTaskInput] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    if (selectedId) {
      setHighlightedContactId(Number(selectedId));
      setTimeout(() => {
        const el = document.getElementById(`contact-row-${selectedId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, []);

  const { data: contacts = [], isLoading: loadingContacts } = useQuery<ContactWithAccount[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: accountsResp } = useQuery<{ data: Account[] }>({
    queryKey: ["/api/accounts"],
  });
  const accounts = accountsResp?.data ?? [];

  const { data: tagsData = [] } = useQuery<Array<{ id: number; name: string; color: string }>>({
    queryKey: ["/api/tags"],
  });

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const enriched: ContactWithAccount[] = contacts.map((c) => ({
    ...c,
    accountName: accountMap[c.accountId] ?? "—",
  }));

  const filtered = enriched.filter((c) => {
    const q = search.toLowerCase();
    if (q && !(
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q) ||
      c.accountName?.toLowerCase().includes(q)
    )) return false;
    if (primaryFilter === "primary" && !c.isPrimary) return false;
    if (primaryFilter === "non_primary" && c.isPrimary) return false;
    if (relationshipFilter !== "all" && (c.relationshipStrength ?? "") !== relationshipFilter) return false;
    if (roleTypeFilter !== "all" && (c.roleType ?? "") !== roleTypeFilter) return false;
    if (emailFilter === "has_email" && !c.email) return false;
    if (emailFilter === "no_email" && c.email) return false;
    return true;
  });

  const currentFiltersJson = useMemo(
    () => JSON.stringify({ search, primaryFilter, relationshipFilter, roleTypeFilter, emailFilter, sortOrder }),
    [search, primaryFilter, relationshipFilter, roleTypeFilter, emailFilter, sortOrder]
  );

  // Static role type list — always matches the options in Edit Contact
  const ROLE_TYPE_OPTIONS = [
    { value: "decision_maker", label: "Decision maker" },
    { value: "champion",       label: "Champion" },
    { value: "influencer",     label: "Influencer" },
    { value: "user",           label: "End user" },
    { value: "gatekeeper",     label: "Gatekeeper" },
    { value: "technical",      label: "Technical" },
    { value: "finance",        label: "Finance" },
    { value: "executive",      label: "Executive" },
  ] as const;

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const na = (a.name ?? "").toLowerCase();
      const nb = (b.name ?? "").toLowerCase();
      return sortOrder === "name_asc" ? na.localeCompare(nb) : nb.localeCompare(na);
    });
    return copy;
  }, [filtered, sortOrder]);

  // ── Bulk selection helpers ────────────────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(sorted.map(c => c.id)));
  const clearSelection = () => setSelectedIds(new Set());

  // ── Saved view helpers ────────────────────────────────────────────────────
  const applyView = (sv: SavedView) => {
    setActiveViewId(sv.id);
    if (sv.filtersJson) {
      try {
        const f = JSON.parse(sv.filtersJson);
        if (f.search !== undefined) setSearch(f.search);
        if (f.primaryFilter !== undefined) setPrimaryFilter(f.primaryFilter);
        if (f.relationshipFilter !== undefined) setRelationshipFilter(f.relationshipFilter);
        if (f.roleTypeFilter !== undefined) setRoleTypeFilter(f.roleTypeFilter);
        if (f.emailFilter !== undefined) setEmailFilter(f.emailFilter);
        if (f.sortOrder !== undefined) setSortOrder(f.sortOrder);
      } catch {}
    }
  };

  const clearView = () => {
    setActiveViewId(null);
    setSearch("");
    setPrimaryFilter("all");
    setRelationshipFilter("all");
    setRoleTypeFilter("all");
    setEmailFilter("all");
    setSortOrder("name_asc");
  };

  // ── Bulk mutations ────────────────────────────────────────────────────────
  const bulkTagMutation = useMutation({
    mutationFn: async (tagId: number) => {
      const res = await apiRequest("POST", "/api/contacts/bulk/tag", {
        contactIds: Array.from(selectedIds),
        tagId,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      clearSelection();
      toast({ title: "Tag added to contacts" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkTaskMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/contacts/bulk/task", {
        contactIds: Array.from(selectedIds),
        title,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      clearSelection();
      setShowTaskInput(false);
      setBulkTaskTitle("");
      toast({ title: `Created ${data.created} tasks` });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // ── Delete contact ────────────────────────────────────────────────────────
  const [contactToDelete, setContactToDelete] = useState<ContactWithAccount | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/contacts/${id}`);
      if (!res.ok) throw new Error((await res.json()).message ?? "Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact deleted" });
      setContactToDelete(null);
    },
    onError: (err: any) => toast({ title: "Could not delete contact", description: err.message, variant: "destructive" }),
  });

  const isAllSelected = sorted.length > 0 && sorted.every(c => selectedIds.has(c.id));
  const isSomeSelected = sorted.some(c => selectedIds.has(c.id)) && !isAllSelected;

  const bulkActions = [
    {
      key: "tag",
      label: "Add Tag",
      icon: <Tag className="h-3.5 w-3.5" />,
      testId: "button-bulk-contacts-tag",
      requiresPermission: canEdit,
      onClick: async () => {},
      disabled: true,
    },
    {
      key: "task",
      label: "Create Task",
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      testId: "button-bulk-contacts-task",
      confirmText: (count: number) => `Create a follow-up task for ${count} contact${count !== 1 ? "s" : ""}`,
      requiresPermission: canEdit,
      isPending: bulkTaskMutation.isPending,
      onClick: async () => {
        const title = bulkTaskTitle.trim() || "Follow up";
        await bulkTaskMutation.mutateAsync(title);
      },
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex items-center gap-3 mb-3">
          <div className="shrink-0">
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              All contacts across your accounts
            </p>
          </div>
          <div className="flex-1 relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/30 border-transparent focus-visible:border-primary/50 rounded-lg"
              data-testid="input-search-contacts"
            />
          </div>
          <div className="ml-auto shrink-0">
            {canEdit && (
              <Button
                size="sm"
                onClick={() => setCreateContactOpen(true)}
                className="gap-1.5"
                data-testid="button-new-contact-header"
              >
                <UserPlus className="w-4 h-4" />
                New Contact
              </Button>
            )}
          </div>
        </div>
        {/* Filter dropdowns */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Select value={primaryFilter} onValueChange={setPrimaryFilter}>
            <SelectTrigger className="h-8 text-xs w-36 bg-secondary/30 border-transparent" data-testid="select-filter-primary">
              <SelectValue placeholder="All Contacts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contacts</SelectItem>
              <SelectItem value="primary">Primary Only</SelectItem>
              <SelectItem value="non_primary">Non-Primary</SelectItem>
            </SelectContent>
          </Select>

          <Select value={relationshipFilter} onValueChange={setRelationshipFilter}>
            <SelectTrigger className="h-8 text-xs w-36 bg-secondary/30 border-transparent" data-testid="select-filter-relationship">
              <SelectValue placeholder="All Relationships" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Relationships</SelectItem>
              <SelectItem value="strong">Strong</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="developing">Developing</SelectItem>
              <SelectItem value="work">Work</SelectItem>
              <SelectItem value="weak">Weak</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>

          <Select value={roleTypeFilter} onValueChange={setRoleTypeFilter}>
            <SelectTrigger className="h-8 text-xs w-40 bg-secondary/30 border-transparent" data-testid="select-filter-role-type">
              <SelectValue placeholder="All Role Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Role Types</SelectItem>
              {ROLE_TYPE_OPTIONS.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as "name_asc" | "name_desc")}>
            <SelectTrigger className="h-8 text-xs w-28 bg-secondary/30 border-transparent" data-testid="select-sort-contacts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">A → Z</SelectItem>
              <SelectItem value="name_desc">Z → A</SelectItem>
            </SelectContent>
          </Select>

          <Select value={emailFilter} onValueChange={setEmailFilter}>
            <SelectTrigger className="h-8 text-xs w-32 bg-secondary/30 border-transparent" data-testid="select-filter-email">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="has_email">Has Email</SelectItem>
              <SelectItem value="no_email">No Email</SelectItem>
            </SelectContent>
          </Select>

          {(primaryFilter !== "all" || relationshipFilter !== "all" || roleTypeFilter !== "all" || emailFilter !== "all") && (
            <button
              onClick={() => { setPrimaryFilter("all"); setRelationshipFilter("all"); setRoleTypeFilter("all"); setEmailFilter("all"); }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5"
              data-testid="button-clear-contact-filters"
            >
              Clear filters
            </button>
          )}
        </div>

        <SavedViewsBar
          pageKey="contacts"
          activeViewId={activeViewId}
          currentFiltersJson={currentFiltersJson}
          onApply={applyView}
          onClear={clearView}
        />
      </div>

      {/* Bulk task title input (shown when create task action triggered) */}
      {showTaskInput && (
        <div className="px-6 py-2 bg-muted/20 border-b border-border/30 flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground shrink-0">Task title:</span>
          <Input
            autoFocus
            value={bulkTaskTitle}
            onChange={e => setBulkTaskTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && bulkTaskTitle.trim()) bulkTaskMutation.mutate(bulkTaskTitle.trim());
              if (e.key === "Escape") { setShowTaskInput(false); setBulkTaskTitle(""); }
            }}
            placeholder="e.g. Follow up after conference"
            data-testid="input-bulk-task-title"
            className="h-8 text-sm flex-1"
          />
          <button
            onClick={() => bulkTaskMutation.mutate(bulkTaskTitle.trim() || "Follow up")}
            disabled={bulkTaskMutation.isPending}
            className="text-[12px] px-3 py-1.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            data-testid="button-bulk-task-submit"
          >
            Create
          </button>
        </div>
      )}

      {/* Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={sorted.length}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          entityLabel="contact"
          actions={[
            {
              key: "task",
              label: "Create Task",
              icon: <ClipboardList className="h-3.5 w-3.5" />,
              testId: "button-bulk-contacts-task",
              confirmText: (count) => `Create a follow-up task for ${count} contact${count !== 1 ? "s" : ""}. Enter a title on the next screen.`,
              requiresPermission: canEdit,
              isPending: bulkTaskMutation.isPending,
              onClick: async () => {
                setShowTaskInput(true);
              },
            },
          ]}
        />
      )}

      <div className="flex-1 overflow-auto px-6 py-4">
        {loadingContacts ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCircle2 className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No contacts found</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {search ? "Try a different search term" : "Add contacts from within an account"}
            </p>
          </div>
        ) : (
          <>
            {/* Header row with select-all */}
            <div className="flex items-center gap-3 px-4 py-2 mb-1">
              <BulkCheckbox
                checked={isAllSelected}
                indeterminate={isSomeSelected}
                onChange={() => isAllSelected ? clearSelection() : selectAll()}
                testId="checkbox-select-all-contacts"
              />
              <span className="text-[11px] text-muted-foreground/50">
                {sorted.length} contact{sorted.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-1.5">
              {sorted.map((contact) => {
                const isHighlighted = highlightedContactId === contact.id;
                const isSelected = selectedIds.has(contact.id);
                return (
                  <div
                    key={contact.id}
                    id={`contact-row-${contact.id}`}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 border transition-all group cursor-pointer ${
                      isSelected
                        ? "border-primary/60 bg-primary/5 border-l-[3px] border-l-primary/60"
                        : isHighlighted
                        ? "border-primary/60 ring-1 ring-primary/30 bg-primary/5"
                        : "border-border/30 hover:border-border/60"
                    }`}
                    data-testid={`contact-row-${contact.id}`}
                    onClick={() => navigate(`/contacts/${contact.id}`)}
                  >
                    {/* Checkbox */}
                    <div onClick={e => { e.stopPropagation(); toggleSelect(contact.id); }}>
                      <BulkCheckbox
                        checked={isSelected}
                        onChange={() => toggleSelect(contact.id)}
                        testId={`checkbox-contact-${contact.id}`}
                      />
                    </div>

                    <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-primary">
                        {(contact.firstName?.[0] || contact.name?.[0] || "?").toUpperCase()}
                        {(contact.lastName?.[0] || "").toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate" data-testid={`contact-name-${contact.id}`}>
                          {contact.name}
                        </span>
                        {contact.isPrimary && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">
                            Primary
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {contact.title && (
                          <span className="text-xs text-muted-foreground truncate">{contact.title}</span>
                        )}
                        {contact.title && contact.accountName && (
                          <span className="text-muted-foreground/40 text-xs">·</span>
                        )}
                        {contact.accountName && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Building2 className="w-3 h-3" />
                            {contact.accountName}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                          data-testid={`contact-email-${contact.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span className="hidden lg:inline">{contact.email}</span>
                        </a>
                      )}
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone}`}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                          data-testid={`contact-phone-${contact.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span className="hidden lg:inline">{contact.phone}</span>
                        </a>
                      )}
                      {contact.relationshipStrength && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            contact.relationshipStrength === "strong"
                              ? "border-green-500/40 text-green-400"
                              : contact.relationshipStrength === "weak"
                              ? "border-red-500/40 text-red-400"
                              : "border-border/50 text-muted-foreground"
                          }`}
                        >
                          {contact.relationshipStrength}
                        </Badge>
                      )}
                      {canEdit && (
                        <div
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                                data-testid={`button-contact-menu-${contact.id}`}
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive gap-2"
                                data-testid={`button-delete-contact-${contact.id}`}
                                onClick={() => setContactToDelete(contact)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete contact
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <CreateContactDialog
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        accountId={null}
        onCreated={(created) => {
          queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
          navigate(`/contacts/${created.id}`);
        }}
      />

      <AlertDialog open={!!contactToDelete} onOpenChange={(o) => { if (!o) setContactToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{contactToDelete?.name}</strong> will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-contact-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-contact-confirm"
              onClick={() => contactToDelete && deleteMutation.mutate(contactToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
