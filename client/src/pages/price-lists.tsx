import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Package, Cloud, DollarSign, MoreHorizontal,
  List, ChevronRight, Layers, Wrench, Key, Puzzle, Star, RefreshCw,
  Wand2, ChevronDown, EyeOff, Eye, Globe, Users,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ─── Types ────────────────────────────────────────────────────────────────────
type PriceListItem = {
  id: number; priceListId: number; sku: string; name: string; description: string | null;
  category: string; listPrice: number | null; unitType: string; isRecurring: boolean | null;
  sortOrder: number | null;
  industryCode: string | null; industryName: string | null;
  commercialType: string | null; productFamily: string | null; powerLevel: string | null;
  pricingModel: string | null; billingInterval: string | null;
  isActive: boolean | null; isPrimaryQuoteItem: boolean | null;
  itemCurrency: string | null; notesInternal: string | null; quoteDescription: string | null;
  usageUnit: string | null; royaltyType: string | null; royaltyRate: number | null;
  minimumCommitment: string | null; licensingTerms: string | null; serviceScope: string | null;
  createdAt: string;
};
type PriceListWithItems = {
  id: number; name: string; currency: string; description: string | null;
  isDefault: boolean | null; region: string | null; customerSegment: string | null;
  createdAt: string; updatedAt: string; items: PriceListItem[];
};

// ─── Constants ────────────────────────────────────────────────────────────────
const CURRENCIES = ["CAD", "USD", "GBP", "EUR", "AUD", "MXN"];
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", CAD: "CA$", MXN: "MX$", GBP: "£", EUR: "€", AUD: "A$",
};
const INDUSTRIES = [
  { code: "GEN", name: "General" },
  { code: "MAR", name: "Marine" },
  { code: "RV",  name: "Recreational Vehicle" },
  { code: "RES", name: "Residential" },
  { code: "COM", name: "Commercial" },
  { code: "IND", name: "Industrial" },
  { code: "EV",  name: "Electric Vehicle" },
  { code: "GRID", name: "Grid / Utility" },
];
const COMMERCIAL_TYPES = [
  { value: "system",    label: "System",    code: "SYS" },
  { value: "hardware",  label: "Hardware",  code: "HW"  },
  { value: "software",  label: "Software",  code: "SW"  },
  { value: "service",   label: "Service",   code: "SRV" },
  { value: "licensing", label: "Licensing", code: "LIC" },
  { value: "accessory", label: "Accessory", code: "ACC" },
];
const PRICING_MODELS = [
  { value: "one_time",  label: "One-Time"  },
  { value: "recurring", label: "Recurring" },
  { value: "usage",     label: "Usage / Royalty" },
  { value: "tiered",    label: "Tiered"   },
  { value: "custom",    label: "Custom"   },
];
const UNIT_TYPES = [
  "per unit", "per slip", "per pedestal", "per connector", "per site",
  "per project", "per hour", "per month", "per year", "per licensed unit",
  "per kWh", "per slip / month", "custom",
];
const BILLING_INTERVALS = ["monthly", "annual", "quarterly"];

function currSym(c: string) { return CURRENCY_SYMBOLS[c] || "$"; }
function fmtMoney(n: number | null | undefined, currency: string) {
  if (n === null || n === undefined) return "—";
  return `${currSym(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Commercial Type config ───────────────────────────────────────────────────
const CT_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string; border: string }> = {
  system:    { label: "System",    icon: Layers,   color: "text-cyan-400",   bg: "bg-cyan-500/10",   border: "border-cyan-500/30"   },
  hardware:  { label: "Hardware",  icon: Package,  color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/30"   },
  software:  { label: "Software",  icon: Cloud,    color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  service:   { label: "Service",   icon: Wrench,   color: "text-sky-400",    bg: "bg-sky-500/10",    border: "border-sky-500/30"    },
  licensing: { label: "Licensing", icon: Key,      color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/30"  },
  accessory: { label: "Accessory", icon: Puzzle,   color: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/30"},
};
function ctConf(ct: string | null) {
  return CT_CONFIG[ct || "hardware"] ?? CT_CONFIG.hardware;
}

// ─── Auto-SKU helper ─────────────────────────────────────────────────────────
function buildSku(industryCode: string, commercialType: string, powerLevel: string, modelCode: string) {
  const ctCode = COMMERCIAL_TYPES.find(c => c.value === commercialType)?.code || "HW";
  const parts = ["VS", industryCode || "GEN", ctCode];
  if (powerLevel) parts.push(powerLevel.replace(/\s+/g, "").toUpperCase());
  if (modelCode)  parts.push(modelCode.replace(/\s+/g, "").toUpperCase());
  return parts.join("-");
}

// ─── Commercial Type Badge ────────────────────────────────────────────────────
function CTBadge({ type }: { type: string | null }) {
  const conf = ctConf(type);
  const Icon = conf.icon;
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 px-1.5 py-0 h-5 ${conf.color} ${conf.bg} ${conf.border}`}>
      <Icon className="h-2.5 w-2.5" />
      {conf.label}
    </Badge>
  );
}

// ─── Item Dialog (full commercial engine form) ────────────────────────────────
function ItemDialog({ open, onClose, item, priceListId, listCurrency }: {
  open: boolean; onClose: () => void;
  item?: PriceListItem | null;
  priceListId: number; listCurrency: string;
}) {
  const { toast } = useToast();
  const isEdit = !!item;

  // Identity
  const [sku, setSku] = useState(item?.sku ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [industryCode, setIndustryCode] = useState(item?.industryCode ?? "GEN");
  const [commercialType, setCommercialType] = useState(item?.commercialType ?? "hardware");
  const [productFamily, setProductFamily] = useState(item?.productFamily ?? "");
  const [powerLevel, setPowerLevel] = useState(item?.powerLevel ?? "");
  const [category, setCategory] = useState(item?.category ?? "Hardware");
  const [description, setDescription] = useState(item?.description ?? "");
  // SKU builder
  const [modelCode, setModelCode] = useState("");
  const [skuMode, setSkuMode] = useState<"manual" | "builder">("manual");

  // Pricing
  const [pricingModel, setPricingModel] = useState(item?.pricingModel ?? "one_time");
  const [itemCurrency, setItemCurrency] = useState(item?.itemCurrency ?? listCurrency);
  const [listPrice, setListPrice] = useState(item?.listPrice !== null && item?.listPrice !== undefined ? String(item.listPrice) : "");
  const [unitType, setUnitType] = useState(item?.unitType ?? "per unit");
  const [isRecurring, setIsRecurring] = useState(item?.isRecurring ?? false);
  const [billingInterval, setBillingInterval] = useState(item?.billingInterval ?? "monthly");
  const [usageUnit, setUsageUnit] = useState(item?.usageUnit ?? "");
  const [royaltyRate, setRoyaltyRate] = useState(item?.royaltyRate !== null && item?.royaltyRate !== undefined ? String(item.royaltyRate) : "");

  // Quote behavior
  const [isPrimaryQuoteItem, setIsPrimaryQuoteItem] = useState(item?.isPrimaryQuoteItem ?? false);
  const [isActive, setIsActive] = useState(item?.isActive !== false);
  const [quoteDescription, setQuoteDescription] = useState(item?.quoteDescription ?? "");
  const [notesInternal, setNotesInternal] = useState(item?.notesInternal ?? "");

  // Advanced
  const [serviceScope, setServiceScope] = useState(item?.serviceScope ?? "");
  const [licensingTerms, setLicensingTerms] = useState(item?.licensingTerms ?? "");
  const [minimumCommitment, setMinimumCommitment] = useState(item?.minimumCommitment ?? "");
  const [advOpen, setAdvOpen] = useState(false);

  const industryName = INDUSTRIES.find(i => i.code === industryCode)?.name ?? "General";

  const generatedSku = skuMode === "builder"
    ? buildSku(industryCode, commercialType, powerLevel, modelCode)
    : sku;

  const reset = () => {
    setSku(item?.sku ?? ""); setName(item?.name ?? "");
    setIndustryCode(item?.industryCode ?? "GEN");
    setCommercialType(item?.commercialType ?? "hardware");
    setProductFamily(item?.productFamily ?? ""); setPowerLevel(item?.powerLevel ?? "");
    setCategory(item?.category ?? "Hardware"); setDescription(item?.description ?? "");
    setPricingModel(item?.pricingModel ?? "one_time");
    setItemCurrency(item?.itemCurrency ?? listCurrency);
    setListPrice(item?.listPrice !== null && item?.listPrice !== undefined ? String(item.listPrice) : "");
    setUnitType(item?.unitType ?? "per unit");
    setIsRecurring(item?.isRecurring ?? false);
    setBillingInterval(item?.billingInterval ?? "monthly");
    setUsageUnit(item?.usageUnit ?? ""); setRoyaltyRate(item?.royaltyRate !== null && item?.royaltyRate !== undefined ? String(item.royaltyRate) : "");
    setIsPrimaryQuoteItem(item?.isPrimaryQuoteItem ?? false);
    setIsActive(item?.isActive !== false);
    setQuoteDescription(item?.quoteDescription ?? ""); setNotesInternal(item?.notesInternal ?? "");
    setServiceScope(item?.serviceScope ?? ""); setLicensingTerms(item?.licensingTerms ?? "");
    setMinimumCommitment(item?.minimumCommitment ?? "");
    setAdvOpen(false); setSkuMode("manual"); setModelCode("");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const finalSku = skuMode === "builder" ? generatedSku : sku;
      const body = {
        sku: finalSku, name, description, category, quoteDescription, notesInternal,
        listPrice: pricingModel === "custom" ? null : (listPrice !== "" ? parseFloat(listPrice) : null),
        unitType, isRecurring: pricingModel === "recurring" ? true : isRecurring,
        industryCode, industryName, commercialType, productFamily, powerLevel,
        pricingModel, billingInterval: pricingModel === "recurring" ? billingInterval : null,
        isActive, isPrimaryQuoteItem, itemCurrency,
        usageUnit: pricingModel === "usage" ? usageUnit : null,
        royaltyRate: pricingModel === "usage" && royaltyRate ? parseFloat(royaltyRate) : null,
        serviceScope, licensingTerms, minimumCommitment,
      };
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? "Edit Product" : "Add New Product"}
            <Badge variant="outline" className="text-[10px] font-normal ml-1">Commercial Engine</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-1">
          {/* ── Section 1: Identity ── */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Identity</h3>
            <div className="space-y-3">
              {/* SKU mode toggle */}
              <div className="flex items-center gap-2 mb-1">
                <button
                  type="button"
                  onClick={() => setSkuMode("manual")}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${skuMode === "manual" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-border/80"}`}
                  data-testid="button-sku-manual"
                >
                  Manual SKU
                </button>
                <button
                  type="button"
                  onClick={() => setSkuMode("builder")}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1 ${skuMode === "builder" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-border/80"}`}
                  data-testid="button-sku-builder"
                >
                  <Wand2 className="h-3 w-3" /> Auto-generate SKU
                </button>
                {skuMode === "builder" && (
                  <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                    {generatedSku}
                  </span>
                )}
              </div>

              {skuMode === "manual" ? (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">SKU</label>
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VS-MAR-SYS-30A-SLIP" data-testid="input-item-sku" className="font-mono" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Power / Scope</label>
                    <Input value={powerLevel} onChange={(e) => setPowerLevel(e.target.value)} placeholder="30A, CORE, OEM, ENG…" data-testid="input-power-level" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Model Code</label>
                    <Input value={modelCode} onChange={(e) => setModelCode(e.target.value)} placeholder="SLIP, CONN, CTRL, PRO…" data-testid="input-model-code" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Product Name *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="VoltSafe Marine | 30A Smart Slip Kit" data-testid="input-item-name" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Industry</label>
                  <Select value={industryCode} onValueChange={setIndustryCode}>
                    <SelectTrigger data-testid="select-industry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map(i => (
                        <SelectItem key={i.code} value={i.code}>
                          <span className="font-mono text-[10px] text-muted-foreground mr-2">{i.code}</span>{i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Commercial Type</label>
                  <Select value={commercialType} onValueChange={setCommercialType}>
                    <SelectTrigger data-testid="select-commercial-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMERCIAL_TYPES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Product Family</label>
                  <Input value={productFamily} onChange={(e) => setProductFamily(e.target.value)}
                    placeholder="Shore Power, Marina OS…" data-testid="input-product-family" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Power / Scope Level</label>
                  <Input value={powerLevel} onChange={(e) => setPowerLevel(e.target.value)}
                    placeholder="30A / 125V, CORE, OEM…" data-testid="input-power-level-manual" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Internal product description…" className="resize-none h-20" data-testid="input-item-description" />
              </div>
            </div>
          </div>

          {/* ── Section 2: Pricing ── */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pricing</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Pricing Model</label>
                  <Select value={pricingModel} onValueChange={setPricingModel}>
                    <SelectTrigger data-testid="select-pricing-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICING_MODELS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Currency</label>
                  <Select value={itemCurrency} onValueChange={setItemCurrency}>
                    <SelectTrigger data-testid="select-item-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {currSym(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {pricingModel !== "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      {pricingModel === "usage" ? "Base / Unit Price" : "List Price"} ({itemCurrency})
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currSym(itemCurrency)}</span>
                      <Input value={listPrice} onChange={(e) => setListPrice(e.target.value)}
                        placeholder="0.00" className="pl-7" type="number" min="0" step="0.01"
                        data-testid="input-item-price" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Unit Type</label>
                    <Select value={unitType} onValueChange={setUnitType}>
                      <SelectTrigger data-testid="select-unit-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_TYPES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {pricingModel === "custom" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Unit Type</label>
                  <Select value={unitType} onValueChange={setUnitType}>
                    <SelectTrigger data-testid="select-unit-type-custom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_TYPES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {pricingModel === "recurring" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Billing Interval</label>
                  <Select value={billingInterval} onValueChange={setBillingInterval}>
                    <SelectTrigger data-testid="select-billing-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_INTERVALS.map(b => <SelectItem key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {pricingModel === "usage" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Usage Unit</label>
                  <Input value={usageUnit} onChange={(e) => setUsageUnit(e.target.value)}
                    placeholder="licensed unit, kWh, API call…" data-testid="input-usage-unit" />
                </div>
              )}
            </div>
          </div>

          {/* ── Section 3: Quote Behavior ── */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quote Behavior</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Switch id="primary-item" checked={isPrimaryQuoteItem} onCheckedChange={setIsPrimaryQuoteItem} data-testid="switch-primary-item" />
                  <label htmlFor="primary-item" className="text-sm cursor-pointer flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 text-amber-400" /> Primary Quote Item
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="is-active" checked={isActive} onCheckedChange={setIsActive} data-testid="switch-is-active" />
                  <label htmlFor="is-active" className="text-sm cursor-pointer">Active</label>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Quote Description (customer-facing)</label>
                <Input value={quoteDescription} onChange={(e) => setQuoteDescription(e.target.value)}
                  placeholder="Short description shown on quotes…" data-testid="input-quote-description" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Internal Notes</label>
                <Textarea value={notesInternal} onChange={(e) => setNotesInternal(e.target.value)}
                  placeholder="Pricing rationale, conditions, partner notes…" className="resize-none h-16"
                  data-testid="input-notes-internal" />
              </div>
            </div>
          </div>

          {/* ── Section 4: Advanced ── */}
          <Collapsible open={advOpen} onOpenChange={setAdvOpen}>
            <CollapsibleTrigger asChild>
              <button type="button" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-full hover:text-foreground transition-colors" data-testid="button-toggle-advanced">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advOpen ? "rotate-180" : ""}`} />
                Advanced
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 mt-3">
                {(commercialType === "service" || commercialType === "licensing") && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      {commercialType === "service" ? "Service Scope" : "Licensing Terms"}
                    </label>
                    {commercialType === "service" ? (
                      <Textarea value={serviceScope} onChange={(e) => setServiceScope(e.target.value)}
                        placeholder="What is included in this service engagement…" className="resize-none h-20"
                        data-testid="input-service-scope" />
                    ) : (
                      <Textarea value={licensingTerms} onChange={(e) => setLicensingTerms(e.target.value)}
                        placeholder="Commercial rights, usage restrictions, territory…" className="resize-none h-20"
                        data-testid="input-licensing-terms" />
                    )}
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Minimum Commitment</label>
                  <Input value={minimumCommitment} onChange={(e) => setMinimumCommitment(e.target.value)}
                    placeholder="e.g. 12 months, 500 units…" data-testid="input-minimum-commitment" />
                </div>
                {pricingModel === "usage" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Royalty Rate (optional %)</label>
                    <Input value={royaltyRate} onChange={(e) => setRoyaltyRate(e.target.value)}
                      type="number" min="0" step="0.1" placeholder="e.g. 5" data-testid="input-royalty-rate" />
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} data-testid="button-cancel-item">Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || saveMutation.isPending}
            data-testid="button-save-item"
          >
            {saveMutation.isPending ? "Saving…" : (isEdit ? "Save Changes" : "Add Product")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Price List Dialog ─────────────────────────────────────────────────────────
function PriceListDialog({ open, onClose, priceList }: {
  open: boolean; onClose: () => void; priceList?: PriceListWithItems | null;
}) {
  const { toast } = useToast();
  const isEdit = !!priceList;
  const [name, setName] = useState(priceList?.name ?? "");
  const [currency, setCurrency] = useState(priceList?.currency ?? "CAD");
  const [description, setDescription] = useState(priceList?.description ?? "");
  const [region, setRegion] = useState(priceList?.region ?? "");
  const [customerSegment, setCustomerSegment] = useState(priceList?.customerSegment ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name, currency, description, region: region || null, customerSegment: customerSegment || null };
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
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Canada – Founder Marinas (2026)" data-testid="input-pricelist-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Currency</label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger data-testid="select-pricelist-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c} — {currSym(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Region</label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)}
                placeholder="Canada, US, Global…" data-testid="input-pricelist-region" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer Segment</label>
            <Input value={customerSegment} onChange={(e) => setCustomerSegment(e.target.value)}
              placeholder="Founder Marinas, Enterprise, Partners…" data-testid="input-pricelist-segment" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Who this price list is for…" className="resize-none h-16" data-testid="input-pricelist-description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} data-testid="button-save-pricelist">
            {saveMutation.isPending ? "Saving…" : (isEdit ? "Save Changes" : "Create Price List")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────
function ItemRow({ item, listCurrency, onEdit, onDelete }: {
  item: PriceListItem; listCurrency: string;
  onEdit: (item: PriceListItem) => void; onDelete: (id: number) => void;
}) {
  const ct = item.commercialType ?? "hardware";
  const isPrimary = item.isPrimaryQuoteItem;
  const isInactive = item.isActive === false;
  const displayCurrency = item.itemCurrency ?? listCurrency;

  return (
    <tr
      className={`border-b border-border/30 transition-colors group ${
        isInactive ? "opacity-40" : ""
      } ${isPrimary ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/20"}`}
      data-testid={`item-row-${item.id}`}
    >
      {/* SKU */}
      <td className="py-3 px-4 w-36">
        {item.sku ? (
          <code className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
            {item.sku}
          </code>
        ) : (
          <span className="text-xs text-muted-foreground/30">—</span>
        )}
      </td>

      {/* Name + description */}
      <td className="py-3 px-4">
        <div className="flex items-start gap-2">
          {isPrimary && <Star className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />}
          <div>
            <p className={`text-sm font-medium ${isPrimary ? "text-foreground" : "text-foreground/90"}`}>{item.name}</p>
            {item.quoteDescription && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.quoteDescription}</p>
            )}
            {item.productFamily && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{item.productFamily}</p>
            )}
          </div>
        </div>
      </td>

      {/* Industry + Commercial type */}
      <td className="py-3 px-4 w-40">
        <div className="flex flex-col gap-1">
          <CTBadge type={ct} />
          {item.industryCode && item.industryCode !== "GEN" && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 w-fit text-muted-foreground">
              {item.industryCode}
            </Badge>
          )}
        </div>
      </td>

      {/* Price */}
      <td className="py-3 px-4 text-right w-36">
        {item.pricingModel === "custom" ? (
          <span className="text-xs text-muted-foreground italic">Custom</span>
        ) : (
          <div>
            <span className={`font-mono text-sm font-semibold ${isPrimary ? "text-primary" : "text-foreground/80"}`}>
              {fmtMoney(item.listPrice, displayCurrency)}
            </span>
            {displayCurrency !== listCurrency && (
              <span className="text-[10px] text-muted-foreground ml-1">{displayCurrency}</span>
            )}
          </div>
        )}
      </td>

      {/* Unit + pricing model badges */}
      <td className="py-3 px-4 w-40">
        <p className="text-xs text-muted-foreground">{item.unitType}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {item.pricingModel === "recurring" && (
            <Badge className="text-[9px] h-4 px-1.5 py-0 bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <RefreshCw className="h-2 w-2 mr-1" />
              {item.billingInterval ?? "recurring"}
            </Badge>
          )}
          {item.pricingModel === "usage" && (
            <Badge className="text-[9px] h-4 px-1.5 py-0 bg-orange-500/10 text-orange-400 border border-orange-500/20">
              usage
            </Badge>
          )}
          {isInactive && (
            <Badge className="text-[9px] h-4 px-1.5 py-0 bg-muted text-muted-foreground border border-border">
              inactive
            </Badge>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="py-3 px-4 text-right w-20">
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

  // Filters
  const [filterIndustry, setFilterIndustry] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPricing, setFilterPricing] = useState<string>("all");
  const [filterActive, setFilterActive] = useState<string>("active");

  const listsQuery = useQuery<PriceListWithItems[]>({ queryKey: ["/api/price-lists"] });
  const priceLists = listsQuery.data ?? [];

  const activeList = useMemo(
    () => priceLists.find(l => l.id === activeListId) ?? priceLists[0] ?? null,
    [priceLists, activeListId]
  );

  const filteredItems = useMemo(() => {
    const items = activeList?.items ?? [];
    return items.filter(item => {
      if (filterIndustry !== "all" && item.industryCode !== filterIndustry) return false;
      if (filterType !== "all" && item.commercialType !== filterType) return false;
      if (filterPricing !== "all" && item.pricingModel !== filterPricing) return false;
      if (filterActive === "active" && item.isActive === false) return false;
      if (filterActive === "inactive" && item.isActive !== false) return false;
      return true;
    });
  }, [activeList, filterIndustry, filterType, filterPricing, filterActive]);

  // Counts for tab/filter display
  const countsByType = useMemo(() => {
    const items = activeList?.items ?? [];
    return COMMERCIAL_TYPES.reduce((acc, ct) => {
      acc[ct.value] = items.filter(i => i.commercialType === ct.value).length;
      return acc;
    }, {} as Record<string, number>);
  }, [activeList]);

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

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left sidebar: price list selector ─── */}
      <div className="w-64 flex-shrink-0 border-r border-border/50 flex flex-col bg-card/20 overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border/40">
          <div className="flex items-center justify-between mb-0.5">
            <div>
              <h2 className="text-sm font-semibold">Price Lists</h2>
              <p className="text-[10px] text-muted-foreground">Commercial Engine</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditList(null); setListDialogOpen(true); }}
              data-testid="button-new-pricelist">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 pb-36 md:pb-2 space-y-1">
          {listsQuery.isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : priceLists.length === 0 ? (
            <div className="text-center p-4 text-sm text-muted-foreground">
              <List className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No price lists yet</p>
            </div>
          ) : priceLists.map((list) => {
            const isActive = activeList?.id === list.id;
            return (
              <div
                key={list.id}
                onClick={() => setActiveListId(list.id)}
                className={`group p-3 rounded-lg cursor-pointer transition-all border ${
                  isActive
                    ? "bg-primary/10 border-primary/30"
                    : "bg-card/40 border-border/40 hover:border-border hover:bg-card/70"
                }`}
                data-testid={`pricelist-card-${list.id}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] font-semibold px-1.5 py-0 h-4 ${
                        list.currency === "CAD" ? "border-red-500/40 text-red-400" :
                        list.currency === "USD" ? "border-green-500/40 text-green-400" :
                        "border-primary/40 text-primary"
                      }`}>{list.currency}</Badge>
                      {list.region && (
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <Globe className="h-2.5 w-2.5" />{list.region}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs font-medium truncate leading-tight ${isActive ? "text-primary" : ""}`}>{list.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{list.items.length} products</span>
                      {list.customerSegment && (
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />{list.customerSegment}
                        </span>
                      )}
                    </div>
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
            );
          })}
        </div>
      </div>

      {/* ── Main content ─── */}
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
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-xs font-semibold ${
                      activeList.currency === "CAD" ? "border-red-500/40 text-red-400" :
                      activeList.currency === "USD" ? "border-green-500/40 text-green-400" :
                      "border-primary/40 text-primary"
                    }`}>{activeList.currency}</Badge>
                    {activeList.region && (
                      <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                        <Globe className="h-3 w-3" />{activeList.region}
                      </Badge>
                    )}
                    {activeList.customerSegment && (
                      <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                        <Users className="h-3 w-3" />{activeList.customerSegment}
                      </Badge>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <h1 className="text-xl font-semibold">{activeList.name}</h1>
                  </div>
                  {activeList.description && (
                    <p className="text-sm text-muted-foreground mt-1">{activeList.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeList.items.length} products
                    {Object.entries(countsByType).filter(([, n]) => n > 0).map(([t, n]) => (
                      <span key={t}> · {n} {t}</span>
                    ))}
                  </p>
                </div>
                <Button onClick={handleAddItem} data-testid="button-add-product">
                  <Plus className="h-4 w-4 mr-2" /> Add Product
                </Button>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Commercial type tabs */}
                <Tabs value={filterType} onValueChange={setFilterType}>
                  <TabsList className="h-7">
                    <TabsTrigger value="all" className="text-[11px] h-5 px-2">All ({activeList.items.length})</TabsTrigger>
                    {COMMERCIAL_TYPES.map(ct => {
                      const conf = ctConf(ct.value);
                      const Icon = conf.icon;
                      const count = countsByType[ct.value] ?? 0;
                      if (count === 0) return null;
                      return (
                        <TabsTrigger key={ct.value} value={ct.value} className="text-[11px] h-5 px-2 gap-1">
                          <Icon className="h-2.5 w-2.5" />{ct.label} ({count})
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>

                <div className="flex items-center gap-1.5 ml-auto">
                  {/* Industry filter */}
                  <Select value={filterIndustry} onValueChange={setFilterIndustry}>
                    <SelectTrigger className="h-7 text-xs w-36" data-testid="select-filter-industry">
                      <SelectValue placeholder="Industry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Industries</SelectItem>
                      {INDUSTRIES.map(i => (
                        <SelectItem key={i.code} value={i.code}>{i.code} — {i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Pricing model filter */}
                  <Select value={filterPricing} onValueChange={setFilterPricing}>
                    <SelectTrigger className="h-7 text-xs w-32" data-testid="select-filter-pricing">
                      <SelectValue placeholder="Pricing" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Models</SelectItem>
                      {PRICING_MODELS.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Active filter */}
                  <button
                    type="button"
                    onClick={() => setFilterActive(a => a === "active" ? "all" : a === "all" ? "inactive" : "active")}
                    className="h-7 px-2.5 text-xs rounded-md border border-border/60 hover:border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                    data-testid="button-filter-active"
                  >
                    {filterActive === "active" ? <Eye className="h-3 w-3" /> : filterActive === "inactive" ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3 opacity-50" />}
                    {filterActive === "active" ? "Active" : filterActive === "inactive" ? "Inactive" : "All status"}
                  </button>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-y-auto pb-36 md:pb-6">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Package className="h-12 w-12 mb-3 opacity-20" />
                  <p className="font-medium">No products match your filters</p>
                  <p className="text-sm mt-1">Try adjusting the filters above</p>
                  {activeList.items.length === 0 && (
                    <Button className="mt-4" size="sm" onClick={handleAddItem}>
                      <Plus className="h-4 w-4 mr-2" /> Add First Product
                    </Button>
                  )}
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20">
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-36">SKU</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Product</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-40">Type</th>
                      <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground w-36">Price</th>
                      <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground w-44">Unit / Model</th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Primary items first */}
                    {filteredItems.filter(i => i.isPrimaryQuoteItem).map(item => (
                      <ItemRow key={item.id} item={item} listCurrency={activeList.currency}
                        onEdit={handleEditItem} onDelete={(id) => deleteItemMutation.mutate(id)} />
                    ))}
                    {filteredItems.filter(i => !i.isPrimaryQuoteItem).map(item => (
                      <ItemRow key={item.id} item={item} listCurrency={activeList.currency}
                        onEdit={handleEditItem} onDelete={(id) => deleteItemMutation.mutate(id)} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Dialogs */}
      {activeList && (
        <ItemDialog
          open={itemDialogOpen}
          onClose={() => { setItemDialogOpen(false); setEditItem(null); }}
          item={editItem}
          priceListId={activeList.id}
          listCurrency={activeList.currency}
        />
      )}
      <PriceListDialog
        open={listDialogOpen}
        onClose={() => { setListDialogOpen(false); setEditList(null); }}
        priceList={editList}
      />
    </div>
  );
}
