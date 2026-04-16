import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Package, Cloud, DollarSign, Tag,
  MoreHorizontal, ChevronRight, Save, X, List,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PriceListItem = {
  id: number; priceListId: number; sku: string; name: string; description: string;
  category: string; listPrice: number; unitType: string; isRecurring: boolean;
  sortOrder: number; createdAt: string;
};
type PriceListWithItems = {
  id: number; name: string; currency: string; description: string | null;
  isDefault: boolean; createdAt: string; updatedAt: string;
  items: PriceListItem[];
};

const CURRENCIES = ["CAD", "USD", "GBP", "EUR", "AUD", "MXN"];
const CATEGORIES = [
  { value: "hardware", label: "Hardware" },
  { value: "saas", label: "Software / Services" },
];
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", CAD: "CA$", MXN: "MX$", GBP: "£", EUR: "€", AUD: "A$",
};
function currSym(c: string) { return CURRENCY_SYMBOLS[c] || "$"; }
function fmtMoney(n: number, currency: string) {
  return `${currSym(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Item Edit Dialog ────────────────────────────────────────────────────────
function ItemDialog({ open, onClose, item, priceListId, currency }: {
  open: boolean; onClose: () => void;
  item?: PriceListItem | null;
  priceListId: number; currency: string;
}) {
  const { toast } = useToast();
  const isEdit = !!item;
  const [sku, setSku] = useState(item?.sku ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState(item?.category ?? "hardware");
  const [listPrice, setListPrice] = useState(item ? String(item.listPrice) : "");
  const [unitType, setUnitType] = useState(item?.unitType ?? "unit");
  const [isRecurring, setIsRecurring] = useState(item?.isRecurring ?? false);

  const reset = () => {
    setSku(item?.sku ?? ""); setName(item?.name ?? ""); setDescription(item?.description ?? "");
    setCategory(item?.category ?? "hardware"); setListPrice(item ? String(item.listPrice) : "");
    setUnitType(item?.unitType ?? "unit"); setIsRecurring(item?.isRecurring ?? false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { sku, name, description, category, listPrice: parseFloat(listPrice) || 0, unitType, isRecurring };
      if (isEdit) return apiRequest("PATCH", `/api/price-list-items/${item!.id}`, body);
      return apiRequest("POST", `/api/price-lists/${priceListId}/items`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      toast({ title: isEdit ? "Product updated" : "Product added" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Product" : "Add New Product"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">SKU (optional)</label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. VS-P30A1" data-testid="input-item-sku" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-item-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Product Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VoltSafe Pedestal 30A/120V" data-testid="input-item-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Short product description..." className="resize-none h-20" data-testid="input-item-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">List Price ({currency})</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currSym(currency)}</span>
                <Input value={listPrice} onChange={(e) => setListPrice(e.target.value)}
                  placeholder="0.00" className="pl-7" type="number" min="0" step="0.01"
                  data-testid="input-item-price" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Unit Type</label>
              <Input value={unitType} onChange={(e) => setUnitType(e.target.value)}
                placeholder="unit, slip/yr, marina/yr..." data-testid="input-item-unit" />
            </div>
          </div>
          <div className="flex items-center gap-3 px-1">
            <Switch id="recurring" checked={isRecurring} onCheckedChange={setIsRecurring} data-testid="switch-item-recurring" />
            <label htmlFor="recurring" className="text-sm cursor-pointer">
              Recurring (subscription / annual charge)
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} data-testid="button-save-item">
            {saveMutation.isPending ? "Saving..." : (isEdit ? "Save Changes" : "Add Product")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Price List Edit Dialog ───────────────────────────────────────────────────
function PriceListDialog({ open, onClose, priceList }: {
  open: boolean; onClose: () => void; priceList?: PriceListWithItems | null;
}) {
  const { toast } = useToast();
  const isEdit = !!priceList;
  const [name, setName] = useState(priceList?.name ?? "");
  const [currency, setCurrency] = useState(priceList?.currency ?? "USD");
  const [description, setDescription] = useState(priceList?.description ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name, currency, description };
      if (isEdit) return apiRequest("PATCH", `/api/price-lists/${priceList!.id}`, body);
      return apiRequest("POST", "/api/price-lists", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      toast({ title: isEdit ? "Price list updated" : "Price list created" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Price List" : "New Price List"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Price List Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CAD — Canadian Marinas" data-testid="input-pricelist-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Currency</label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger data-testid="select-pricelist-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {currSym(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Who this price list is for..." className="resize-none h-20" data-testid="input-pricelist-description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} data-testid="button-save-pricelist">
            {saveMutation.isPending ? "Saving..." : (isEdit ? "Save Changes" : "Create Price List")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────
function ItemRow({ item, currency, onEdit, onDelete }: {
  item: PriceListItem; currency: string;
  onEdit: (item: PriceListItem) => void; onDelete: (id: number) => void;
}) {
  return (
    <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors group" data-testid={`item-row-${item.id}`}>
      <td className="py-3 px-4">
        {item.sku ? (
          <Badge variant="outline" className="text-[10px] font-mono">{item.sku}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </td>
      <td className="py-3 px-4">
        <p className="text-sm font-medium">{item.name}</p>
        {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>}
      </td>
      <td className="py-3 px-4">
        <Badge variant={item.category === "hardware" ? "secondary" : "outline"} className="text-[10px]">
          {item.category === "hardware" ? <Package className="h-2.5 w-2.5 mr-1" /> : <Cloud className="h-2.5 w-2.5 mr-1" />}
          {item.category === "hardware" ? "Hardware" : "Software"}
        </Badge>
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm font-semibold text-primary">
        {fmtMoney(item.listPrice, currency)}
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground">{item.unitType}</td>
      <td className="py-3 px-4">
        {item.isRecurring && (
          <Badge className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20">Recurring</Badge>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(item)} data-testid={`button-edit-item-${item.id}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(item.id)} data-testid={`button-delete-item-${item.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function PriceListsPage() {
  const { toast } = useToast();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PriceListItem | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editList, setEditList] = useState<PriceListWithItems | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "hardware" | "saas">("all");

  const listsQuery = useQuery<PriceListWithItems[]>({ queryKey: ["/api/price-lists"] });
  const priceLists = listsQuery.data ?? [];

  const activeList = priceLists.find(l => l.id === activeListId) ?? priceLists[0] ?? null;

  const deleteItemMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/price-list-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] }); toast({ title: "Product removed" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const deleteListMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/price-lists/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      if (activeListId === id) setActiveListId(null);
      toast({ title: "Price list deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleEditItem = (item: PriceListItem) => { setEditItem(item); setItemDialogOpen(true); };
  const handleAddItem = () => { setEditItem(null); setItemDialogOpen(true); };

  const filteredItems = (activeList?.items ?? []).filter(item =>
    categoryFilter === "all" || item.category === categoryFilter
  );
  const hwCount = activeList?.items.filter(i => i.category === "hardware").length ?? 0;
  const swCount = activeList?.items.filter(i => i.category === "saas").length ?? 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left sidebar: price list selector ─── */}
      <div className="w-64 flex-shrink-0 border-r border-border/50 flex flex-col bg-card/20 overflow-hidden">
        <div className="px-4 py-4 border-b border-border/40">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Price Lists</h2>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditList(null); setListDialogOpen(true); }}
              data-testid="button-new-pricelist">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Select a list to manage its products</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 pb-24 md:pb-2 space-y-1">
          {listsQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2].map(i => <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : priceLists.length === 0 ? (
            <div className="text-center p-4 text-sm text-muted-foreground">
              <List className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No price lists yet
            </div>
          ) : priceLists.map((list) => (
            <div
              key={list.id}
              onClick={() => setActiveListId(list.id)}
              className={`group p-3 rounded-lg cursor-pointer transition-all border ${
                (activeList?.id === list.id)
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card/40 border-border/40 hover:border-border hover:bg-card/70"
              }`}
              data-testid={`pricelist-card-${list.id}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className={`text-[10px] font-semibold px-1.5 py-0 h-4 ${
                      list.currency === "CAD" ? "border-red-500/40 text-red-400" :
                      list.currency === "USD" ? "border-green-500/40 text-green-400" :
                      "border-primary/40 text-primary"
                    }`}>{list.currency}</Badge>
                  </div>
                  <p className="text-xs font-medium truncate leading-tight">{list.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{list.items.length} products</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted/50 transition-opacity"
                      data-testid={`button-pricelist-menu-${list.id}`}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditList(list); setListDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteListMutation.mutate(list.id); }}
                      data-testid={`button-delete-pricelist-${list.id}`}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main content: items table ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!activeList ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <DollarSign className="h-16 w-16 mb-4 opacity-20" />
            <p className="font-medium">Select a price list</p>
            <p className="text-sm mt-1">Choose a price list from the left to manage its products</p>
            {priceLists.length === 0 && (
              <Button className="mt-4" onClick={() => { setEditList(null); setListDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Create First Price List
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-border/50 bg-card/30">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-xs font-semibold ${
                      activeList.currency === "CAD" ? "border-red-500/40 text-red-400" :
                      activeList.currency === "USD" ? "border-green-500/40 text-green-400" :
                      "border-primary/40 text-primary"
                    }`}>{activeList.currency}</Badge>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <h1 className="text-xl font-semibold">{activeList.name}</h1>
                  </div>
                  {activeList.description && (
                    <p className="text-sm text-muted-foreground">{activeList.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeList.items.length} products · {hwCount} hardware · {swCount} software/services
                  </p>
                </div>
                <Button onClick={handleAddItem} data-testid="button-add-product">
                  <Plus className="h-4 w-4 mr-2" /> Add Product
                </Button>
              </div>

              {/* Category tabs */}
              <Tabs value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)} className="mt-3">
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs h-6">All ({activeList.items.length})</TabsTrigger>
                  <TabsTrigger value="hardware" className="text-xs h-6">
                    <Package className="h-3 w-3 mr-1" /> Hardware ({hwCount})
                  </TabsTrigger>
                  <TabsTrigger value="saas" className="text-xs h-6">
                    <Cloud className="h-3 w-3 mr-1" /> Software ({swCount})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-y-auto pb-24 md:pb-6">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Package className="h-12 w-12 mb-3 opacity-20" />
                  <p className="font-medium">No products yet</p>
                  <p className="text-sm mt-1">Add your first product to this price list</p>
                  <Button className="mt-4" size="sm" onClick={handleAddItem}>
                    <Plus className="h-4 w-4 mr-2" /> Add Product
                  </Button>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-28">SKU</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Product</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-36">Category</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground w-32">List Price</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-28">Unit</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-24">Type</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        currency={activeList.currency}
                        onEdit={handleEditItem}
                        onDelete={(id) => deleteItemMutation.mutate(id)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      <ItemDialog
        open={itemDialogOpen}
        onClose={() => { setItemDialogOpen(false); setEditItem(null); }}
        item={editItem}
        priceListId={activeList?.id ?? 0}
        currency={activeList?.currency ?? "USD"}
      />
      <PriceListDialog
        open={listDialogOpen}
        onClose={() => { setListDialogOpen(false); setEditList(null); }}
        priceList={editList}
      />
    </div>
  );
}
