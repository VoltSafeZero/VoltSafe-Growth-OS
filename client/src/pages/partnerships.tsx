import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AttachmentsSection } from "@/components/attachments-section";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, Loader2, Globe, MapPin, Pencil, X } from "lucide-react";
import type { Partnership } from "@shared/schema";

const INDUSTRY_TYPES = [
  "Industry & Associations",
  "Government & Public Sector",
  "Channel & Commercial Partners",
  "Technology & Manufacturing",
  "Innovation & Research",
  "Advisory & Professional Services",
  "Media & Ecosystem",
] as const;

type IndustryType = typeof INDUSTRY_TYPES[number];

const SLUG_TO_TYPE: Record<string, IndustryType> = {
  "industry-associations": "Industry & Associations",
  "government-public": "Government & Public Sector",
  "channel-commercial": "Channel & Commercial Partners",
  "technology-manufacturing": "Technology & Manufacturing",
  "innovation-research": "Innovation & Research",
  "advisory-professional": "Advisory & Professional Services",
  "media-ecosystem": "Media & Ecosystem",
};

const TYPE_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_TYPE).map(([slug, type]) => [type, slug])
);

const TYPE_COLORS: Record<string, string> = {
  "Industry & Associations": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Government & Public Sector": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Channel & Commercial Partners": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  "Technology & Manufacturing": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "Innovation & Research": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  "Advisory & Professional Services": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Media & Ecosystem": "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

function IndustryTypePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (types: string[]) => void;
}) {
  const toggle = (type: string) => {
    if (selected.includes(type)) {
      onChange(selected.filter((t) => t !== type));
    } else {
      onChange([...selected, type]);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1">
      {INDUSTRY_TYPES.map((type) => (
        <label
          key={type}
          className="flex items-center gap-2.5 cursor-pointer group"
          data-testid={`checkbox-industry-${type.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}
        >
          <Checkbox
            checked={selected.includes(type)}
            onCheckedChange={() => toggle(type)}
            id={`it-${type}`}
          />
          <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
            {type}
          </span>
        </label>
      ))}
    </div>
  );
}

interface FormState {
  name: string;
  region: string;
  country: string;
  website: string;
  notes: string;
  industryTypes: string[];
  strategicImportance: string;
  keyContacts: string;
  membershipStatus: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    region: "",
    country: "",
    website: "",
    notes: "",
    industryTypes: [],
    strategicImportance: "",
    keyContacts: "",
    membershipStatus: "",
  };
}

function formFromPartner(p: Partnership): FormState {
  return {
    name: p.name,
    region: p.region || "",
    country: p.country || "",
    website: p.website || "",
    notes: p.notes || "",
    industryTypes: p.industryTypes || [],
    strategicImportance: p.strategicImportance || "",
    keyContacts: p.keyContacts || "",
    membershipStatus: p.membershipStatus || "",
  };
}

function PartnerForm({
  initialData,
  onSubmit,
  isPending,
  onCancel,
}: {
  initialData?: Partnership;
  onSubmit: (data: FormState) => void;
  isPending: boolean;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initialData ? formFromPartner(initialData) : emptyForm()
  );

  const set = (k: keyof FormState, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
            data-testid="input-partner-name"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="region">Region</Label>
            <Input
              id="region"
              value={form.region}
              onChange={(e) => set("region", e.target.value)}
              data-testid="input-partner-region"
            />
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              data-testid="input-partner-country"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            data-testid="input-partner-website"
          />
        </div>
      </div>

      <div className="border-t border-border/50 pt-3 space-y-3">
        <div>
          <Label className="block mb-2">
            Industry Type{" "}
            <span className="text-muted-foreground font-normal">(select one or more)</span>
          </Label>
          <IndustryTypePicker
            selected={form.industryTypes}
            onChange={(v) => set("industryTypes", v)}
          />
        </div>
      </div>

      <div className="border-t border-border/50 pt-3 space-y-3">
        <div>
          <Label htmlFor="strategicImportance">Strategic Importance</Label>
          <Input
            id="strategicImportance"
            value={form.strategicImportance}
            onChange={(e) => set("strategicImportance", e.target.value)}
            placeholder="Low / Medium / High / Critical"
            data-testid="input-partner-strategic-importance"
          />
        </div>
        <div>
          <Label htmlFor="keyContacts">Key Contacts</Label>
          <Input
            id="keyContacts"
            value={form.keyContacts}
            onChange={(e) => set("keyContacts", e.target.value)}
            data-testid="input-partner-key-contacts"
          />
        </div>
        <div>
          <Label htmlFor="membershipStatus">Membership Status</Label>
          <Input
            id="membershipStatus"
            value={form.membershipStatus}
            onChange={(e) => set("membershipStatus", e.target.value)}
            placeholder="Member / Sponsor / Board / None"
            data-testid="input-partner-membership-status"
          />
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            data-testid="textarea-partner-notes"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isPending || !form.name.trim()}
          className="ml-auto"
          data-testid="button-submit-partner"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {initialData ? "Save Changes" : "Create"}
        </Button>
      </div>
    </form>
  );
}

function PartnerDetailDialog({
  partner,
  onClose,
  onUpdate,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  partner: Partnership;
  onClose: () => void;
  onUpdate: (data: FormState) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {editing ? (
          <>
            <DialogHeader><DialogTitle>Edit Partner</DialogTitle></DialogHeader>
            <PartnerForm
              initialData={partner}
              onSubmit={(data) => { onUpdate(data); setEditing(false); }}
              isPending={isUpdating}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl" data-testid="text-detail-name">{partner.name}</DialogTitle>
              {(partner.industryTypes && partner.industryTypes.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {partner.industryTypes.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className={`text-xs ${TYPE_COLORS[t] || ""}`}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                {partner.region && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Region</Label>
                    <p className="text-sm mt-0.5">{partner.region}</p>
                  </div>
                )}
                {partner.country && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Country</Label>
                    <p className="text-sm mt-0.5">{partner.country}</p>
                  </div>
                )}
                {partner.website && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Website</Label>
                    <a
                      href={partner.website.startsWith("http") ? partner.website : `https://${partner.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary block truncate"
                      data-testid="link-website"
                    >
                      {partner.website}
                    </a>
                  </div>
                )}
                {partner.strategicImportance && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Strategic Importance</Label>
                    <p className="text-sm mt-0.5">{partner.strategicImportance}</p>
                  </div>
                )}
                {partner.membershipStatus && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Membership Status</Label>
                    <p className="text-sm mt-0.5">{partner.membershipStatus}</p>
                  </div>
                )}
                {partner.keyContacts && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Key Contacts</Label>
                    <p className="text-sm mt-0.5">{partner.keyContacts}</p>
                  </div>
                )}
              </div>

              {partner.notes && (
                <div className="border-t border-border/50 pt-3">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-0.5 whitespace-pre-wrap">{partner.notes}</p>
                </div>
              )}

              <div className="border-t border-border/50 pt-3">
                <AttachmentsSection objectType="partnership" objectId={partner.id} />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={isDeleting}
                  data-testid="button-delete-partner"
                >
                  {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                  data-testid="button-edit-partner"
                >
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PartnershipsPage({ typeSlug = "" }: { typeSlug?: string }) {
  const [, navigate] = useLocation();
  const initialType: IndustryType | "all" = SLUG_TO_TYPE[typeSlug] || "all";
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<IndustryType | "all">(initialType);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Partnership | null>(null);
  const { toast } = useToast();

  // Sync activeType when the slug changes (user clicks sidebar)
  useEffect(() => {
    setActiveType(SLUG_TO_TYPE[typeSlug] || "all");
  }, [typeSlug]);

  const handleTabClick = (type: IndustryType | "all") => {
    setActiveType(type);
    if (type === "all") {
      navigate("/strategy/partnerships");
    } else {
      navigate(`/strategy/partnerships/${TYPE_TO_SLUG[type]}`);
    }
  };

  const { data: allPartners, isLoading } = useQuery<Partnership[]>({
    queryKey: ["/api/partnerships", { industryType: activeType === "all" ? undefined : activeType, search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeType !== "all") params.set("industryType", activeType);
      if (search) params.set("search", search);
      const res = await fetch(`/api/partnerships?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormState) => {
      const payload = {
        ...data,
        category: "all_partnerships",
        industryTypes: data.industryTypes.length > 0 ? data.industryTypes : null,
        region: data.region || null,
        country: data.country || null,
        website: data.website || null,
        notes: data.notes || null,
        strategicImportance: data.strategicImportance || null,
        keyContacts: data.keyContacts || null,
        membershipStatus: data.membershipStatus || null,
      };
      const res = await apiRequest("POST", "/api/partnerships", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partnerships"] });
      setCreateOpen(false);
      toast({ title: "Partner created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create partner", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormState }) => {
      const payload = {
        ...data,
        industryTypes: data.industryTypes.length > 0 ? data.industryTypes : null,
        region: data.region || null,
        country: data.country || null,
        website: data.website || null,
        notes: data.notes || null,
        strategicImportance: data.strategicImportance || null,
        keyContacts: data.keyContacts || null,
        membershipStatus: data.membershipStatus || null,
      };
      const res = await apiRequest("PUT", `/api/partnerships/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partnerships"] });
      setSelectedPartner(null);
      toast({ title: "Partner updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update partner", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/partnerships/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partnerships"] });
      setSelectedPartner(null);
      toast({ title: "Partner deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete partner", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Industry Partnerships
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage all strategic industry partners, contacts, and collaborators.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-partner">
              <Plus className="mr-2 h-4 w-4" /> New Partner
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Industry Partner</DialogTitle></DialogHeader>
            <PartnerForm
              onSubmit={(d) => createMutation.mutate(d)}
              isPending={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search partners..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
          data-testid="input-search-partners"
        />
      </div>

      {/* Category filter tabs */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-2 min-w-max">
          <button
            onClick={() => handleTabClick("all")}
            data-testid="tab-all-partnerships"
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border whitespace-nowrap ${
              activeType === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            ALL Partnerships
          </button>
          {INDUSTRY_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => handleTabClick(type === activeType ? "all" : type)}
              data-testid={`tab-${type.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border whitespace-nowrap ${
                activeType === type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Active filter badge */}
      {activeType !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          <Badge
            variant="outline"
            className={`${TYPE_COLORS[activeType] || ""} cursor-pointer`}
            onClick={() => handleTabClick("all")}
            data-testid="badge-active-filter"
          >
            {activeType}
            <X className="h-3 w-3 ml-1.5" />
          </Badge>
        </div>
      )}

      {/* Partners grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allPartners?.map((partner) => (
            <Card
              key={partner.id}
              className="border-border/50 cursor-pointer transition-colors hover-elevate"
              onClick={() => setSelectedPartner(partner)}
              data-testid={`card-partner-${partner.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-medium truncate" data-testid={`text-partner-name-${partner.id}`}>
                    {partner.name}
                  </p>
                  {partner.strategicImportance && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {partner.strategicImportance}
                    </Badge>
                  )}
                </div>
                {partner.industryTypes && partner.industryTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {partner.industryTypes.slice(0, 2).map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[t] || ""}`}
                        data-testid={`badge-type-${partner.id}-${t.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}
                      >
                        {t}
                      </Badge>
                    ))}
                    {partner.industryTypes.length > 2 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        +{partner.industryTypes.length - 2}
                      </Badge>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  {partner.website && (
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Website
                    </span>
                  )}
                  {(partner.region || partner.country) && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {[partner.region, partner.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
                {partner.notes && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{partner.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
          {(!allPartners || allPartners.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground" data-testid="text-empty-state">
              {activeType === "all"
                ? `No partners found. Click "New Partner" to add one.`
                : `No partners found for "${activeType}". Click "New Partner" to add one.`}
            </div>
          )}
        </div>
      )}

      {/* Detail dialog */}
      {selectedPartner && (
        <PartnerDetailDialog
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
          onUpdate={(data) => updateMutation.mutate({ id: selectedPartner.id, data })}
          onDelete={() => deleteMutation.mutate(selectedPartner.id)}
          isUpdating={updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
