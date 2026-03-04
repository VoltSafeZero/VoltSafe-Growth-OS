import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, Loader2, Globe, MapPin, Pencil } from "lucide-react";
import type { Partnership } from "@shared/schema";

const CATEGORY_TITLES: Record<string, string> = {
  strategic_industry: "Strategic Industry Partners",
  technology: "Technology & Integration Partners",
  distribution: "Distribution & Channel Partners",
  oem: "OEM & Licensing Partners",
  government: "Government & Grant Partners",
  research: "Research & Innovation Partners",
  pilot: "Pilot & Lighthouse Marinas",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  strategic_industry: "Manage associations, standards bodies, and industry groups.",
  technology: "Track technology integrations and API partnerships.",
  distribution: "Manage distributors, installers, and channel partners.",
  oem: "Track OEM and licensing partnerships.",
  government: "Manage government grants and funding programs.",
  research: "Track research collaborations and innovation programs.",
  pilot: "Manage pilot deployments and lighthouse marina sites.",
};

interface CategoryFieldConfig {
  key: string;
  label: string;
  type: "text" | "select" | "number" | "boolean" | "date" | "textarea";
  options?: string[];
}

const CATEGORY_FIELDS: Record<string, CategoryFieldConfig[]> = {
  strategic_industry: [
    { key: "organizationType", label: "Organization Type", type: "select", options: ["Association", "Standards Body", "Port Authority", "Industry Group"] },
    { key: "membershipStatus", label: "Membership Status", type: "select", options: ["Member", "Sponsor", "Board", "None"] },
    { key: "strategicImportance", label: "Strategic Importance", type: "select", options: ["Low", "Medium", "High", "Critical"] },
    { key: "influenceScore", label: "Influence Score", type: "number" },
    { key: "marinasRepresented", label: "Marinas Represented", type: "number" },
    { key: "keyContacts", label: "Key Contacts", type: "text" },
    { key: "eventsHosted", label: "Events Hosted", type: "text" },
    { key: "speakingOpportunities", label: "Speaking Opportunities", type: "text" },
  ],
  technology: [
    { key: "technologyCategory", label: "Technology Category", type: "select", options: ["CRM", "Metering", "Payment", "IoT", "Infrastructure"] },
    { key: "integrationStatus", label: "Integration Status", type: "select", options: ["None", "Planned", "In Progress", "Active"] },
    { key: "apiAvailable", label: "API Available", type: "boolean" },
    { key: "integrationType", label: "Integration Type", type: "select", options: ["Native", "API", "Data Sync"] },
    { key: "technicalContact", label: "Technical Contact", type: "text" },
    { key: "jointRoadmapNotes", label: "Joint Roadmap Notes", type: "textarea" },
    { key: "priorityLevel", label: "Priority Level", type: "select", options: ["Low", "Medium", "High", "Critical"] },
    { key: "integrationDocLink", label: "Integration Doc Link", type: "text" },
  ],
  distribution: [
    { key: "channelType", label: "Channel Type", type: "select", options: ["Distributor", "Installer", "Builder", "Contractor"] },
    { key: "territory", label: "Territory", type: "text" },
    { key: "salesReach", label: "Sales Reach", type: "number" },
    { key: "certificationStatus", label: "Certification Status", type: "select", options: ["Untrained", "Training", "Certified"] },
    { key: "trainingCompletedDate", label: "Training Completed Date", type: "date" },
    { key: "dealRegistrationEnabled", label: "Deal Registration Enabled", type: "boolean" },
    { key: "activeOpportunities", label: "Active Opportunities", type: "number" },
    { key: "revenueGenerated", label: "Revenue Generated", type: "number" },
  ],
  oem: [
    { key: "industry", label: "Industry", type: "select", options: ["Marine", "EV", "Industrial", "Defense", "Infrastructure"] },
    { key: "licenseType", label: "License Type", type: "select", options: ["Technology", "Hardware", "Software"] },
    { key: "territory", label: "Territory", type: "text" },
    { key: "royaltyStructure", label: "Royalty Structure", type: "text" },
    { key: "contractStatus", label: "Contract Status", type: "select", options: ["Exploration", "NDA", "Negotiation", "Signed"] },
    { key: "productIntegrationDescription", label: "Product Integration", type: "textarea" },
    { key: "expectedRevenuePotential", label: "Expected Revenue Potential", type: "text" },
    { key: "strategicImportance", label: "Strategic Importance", type: "select", options: ["Low", "Medium", "High", "Critical"] },
  ],
  government: [
    { key: "agencyBody", label: "Agency / Body", type: "text" },
    { key: "grantType", label: "Grant Type", type: "select", options: ["Pilot", "R&D", "Infrastructure", "Subsidy"] },
    { key: "fundingAmount", label: "Funding Amount", type: "number" },
    { key: "applicationStatus", label: "Application Status", type: "select", options: ["Not Applied", "Applied", "Approved", "Completed"] },
    { key: "reportingRequirements", label: "Reporting Requirements", type: "textarea" },
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "endDate", label: "End Date", type: "date" },
    { key: "deliverables", label: "Deliverables", type: "textarea" },
  ],
  research: [
    { key: "institutionType", label: "Institution Type", type: "select", options: ["University", "Accelerator", "Lab", "Innovation Hub"] },
    { key: "researchFocus", label: "Research Focus", type: "text" },
    { key: "programName", label: "Program Name", type: "text" },
    { key: "projectDescription", label: "Project Description", type: "textarea" },
    { key: "participationStatus", label: "Participation Status", type: "select", options: ["Applied", "Active", "Completed"] },
    { key: "ipConsiderations", label: "IP Considerations", type: "textarea" },
    { key: "keyResearchers", label: "Key Researchers", type: "text" },
  ],
  pilot: [
    { key: "slipCount", label: "Slip Count", type: "number" },
    { key: "pilotStatus", label: "Pilot Status", type: "select", options: ["Planned", "Active", "Completed"] },
    { key: "deploymentSize", label: "Deployment Size", type: "number" },
    { key: "productVersionInstalled", label: "Product Version Installed", type: "text" },
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "caseStudyStatus", label: "Case Study Status", type: "text" },
    { key: "testimonialStatus", label: "Testimonial Status", type: "text" },
    { key: "operationalFeedback", label: "Operational Feedback", type: "textarea" },
  ],
};

function getStatusBadge(category: string, partner: Partnership) {
  if (category === "strategic_industry" && partner.membershipStatus) {
    const colors: Record<string, string> = {
      Member: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      Sponsor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
      Board: "bg-green-500/10 text-green-500 border-green-500/20",
      None: "bg-gray-500/10 text-gray-500 border-gray-500/20",
    };
    return { label: partner.membershipStatus, color: colors[partner.membershipStatus] || "" };
  }
  if (category === "technology" && partner.integrationStatus) {
    const colors: Record<string, string> = {
      None: "bg-gray-500/10 text-gray-500 border-gray-500/20",
      Planned: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      "In Progress": "bg-blue-500/10 text-blue-500 border-blue-500/20",
      Active: "bg-green-500/10 text-green-500 border-green-500/20",
    };
    return { label: partner.integrationStatus, color: colors[partner.integrationStatus] || "" };
  }
  if (category === "distribution" && partner.certificationStatus) {
    const colors: Record<string, string> = {
      Untrained: "bg-gray-500/10 text-gray-500 border-gray-500/20",
      Training: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      Certified: "bg-green-500/10 text-green-500 border-green-500/20",
    };
    return { label: partner.certificationStatus, color: colors[partner.certificationStatus] || "" };
  }
  if (category === "oem" && partner.contractStatus) {
    const colors: Record<string, string> = {
      Exploration: "bg-gray-500/10 text-gray-500 border-gray-500/20",
      NDA: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      Negotiation: "bg-blue-500/10 text-blue-500 border-blue-500/20",
      Signed: "bg-green-500/10 text-green-500 border-green-500/20",
    };
    return { label: partner.contractStatus, color: colors[partner.contractStatus] || "" };
  }
  if (category === "government" && partner.applicationStatus) {
    const colors: Record<string, string> = {
      "Not Applied": "bg-gray-500/10 text-gray-500 border-gray-500/20",
      Applied: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      Approved: "bg-green-500/10 text-green-500 border-green-500/20",
      Completed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    };
    return { label: partner.applicationStatus, color: colors[partner.applicationStatus] || "" };
  }
  if (category === "research" && partner.participationStatus) {
    const colors: Record<string, string> = {
      Applied: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      Active: "bg-green-500/10 text-green-500 border-green-500/20",
      Completed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    };
    return { label: partner.participationStatus, color: colors[partner.participationStatus] || "" };
  }
  if (category === "pilot" && partner.pilotStatus) {
    const colors: Record<string, string> = {
      Planned: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
      Active: "bg-green-500/10 text-green-500 border-green-500/20",
      Completed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    };
    return { label: partner.pilotStatus, color: colors[partner.pilotStatus] || "" };
  }
  return null;
}

function getSubtitle(category: string, partner: Partnership): string {
  const parts: string[] = [];
  if (category === "strategic_industry" && partner.organizationType) parts.push(partner.organizationType);
  if (category === "technology" && partner.technologyCategory) parts.push(partner.technologyCategory);
  if (category === "distribution" && partner.channelType) parts.push(partner.channelType);
  if (category === "oem" && partner.industry) parts.push(partner.industry);
  if (category === "government" && partner.grantType) parts.push(partner.grantType);
  if (category === "research" && partner.institutionType) parts.push(partner.institutionType);
  if (category === "pilot" && partner.pilotStatus) parts.push(partner.pilotStatus);
  if (partner.region) parts.push(partner.region);
  if (partner.country) parts.push(partner.country);
  return parts.join(" \u00B7 ");
}

export default function PartnershipsPage({ category }: { category: string }) {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Partnership | null>(null);
  const { toast } = useToast();

  const title = CATEGORY_TITLES[category] || "Partners";
  const description = CATEGORY_DESCRIPTIONS[category] || "";

  const { data: partnerships, isLoading } = useQuery<Partnership[]>({
    queryKey: ["/api/partnerships", { category, search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`/api/partnerships?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/partnerships", { ...data, category });
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
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const res = await apiRequest("PUT", `/api/partnerships/${id}`, data);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">{title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground" data-testid="button-create-partner">
              <Plus className="mr-2 h-4 w-4" /> New Partner
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add {title.replace("Partners", "Partner").replace("Marinas", "Marina")}</DialogTitle></DialogHeader>
            <PartnerForm
              category={category}
              onSubmit={(d) => createMutation.mutate(d)}
              isPending={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 sm:gap-3 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search partners..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            data-testid="input-search-partners"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {partnerships?.map((partner) => {
            const statusBadge = getStatusBadge(category, partner);
            const subtitle = getSubtitle(category, partner);
            return (
              <Card
                key={partner.id}
                className="border-border/50 cursor-pointer transition-colors hover-elevate"
                onClick={() => setSelectedPartner(partner)}
                data-testid={`card-partner-${partner.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate" data-testid={`text-partner-name-${partner.id}`}>{partner.name}</p>
                      {subtitle && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
                      )}
                    </div>
                    {statusBadge && (
                      <Badge variant="outline" className={statusBadge.color} data-testid={`badge-status-${partner.id}`}>
                        {statusBadge.label}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
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
                    {partner.strategicImportance && (
                      <Badge variant="outline" className="text-xs">
                        {partner.strategicImportance}
                      </Badge>
                    )}
                  </div>
                  {partner.notes && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{partner.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {(!partnerships || partnerships.length === 0) && (
            <div className="col-span-full p-8 text-center text-muted-foreground" data-testid="text-empty-state">
              No partners found. Click "New Partner" to add one.
            </div>
          )}
        </div>
      )}

      {selectedPartner && (
        <PartnerDetailDialog
          partner={selectedPartner}
          category={category}
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

function PartnerDetailDialog({
  partner,
  category,
  onClose,
  onUpdate,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  partner: Partnership;
  category: string;
  onClose: () => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const statusBadge = getStatusBadge(category, partner);
  const fields = CATEGORY_FIELDS[category] || [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {editing ? (
          <>
            <DialogHeader><DialogTitle>Edit Partner</DialogTitle></DialogHeader>
            <PartnerForm
              category={category}
              initialData={partner}
              onSubmit={(data) => { onUpdate(data); setEditing(false); }}
              isPending={isUpdating}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <DialogTitle className="text-xl" data-testid="text-detail-name">{partner.name}</DialogTitle>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {statusBadge && (
                      <Badge variant="outline" className={statusBadge.color}>{statusBadge.label}</Badge>
                    )}
                    {partner.strategicImportance && (
                      <Badge variant="outline">{partner.strategicImportance}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <DetailField label="Region" value={partner.region} />
                <DetailField label="Country" value={partner.country} />
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
              </div>

              <div className="border-t border-border/50 pt-3">
                <h3 className="text-sm font-medium mb-3">Category Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {fields.map((field) => {
                    const value = (partner as Record<string, unknown>)[field.key];
                    if (value === null || value === undefined || value === "") return null;
                    if (field.type === "boolean") {
                      return (
                        <DetailField
                          key={field.key}
                          label={field.label}
                          value={value ? "Yes" : "No"}
                        />
                      );
                    }
                    if (field.type === "date" && value) {
                      return (
                        <DetailField
                          key={field.key}
                          label={field.label}
                          value={new Date(value as string).toLocaleDateString()}
                        />
                      );
                    }
                    if (field.type === "textarea") {
                      return (
                        <div key={field.key} className="col-span-2">
                          <Label className="text-xs text-muted-foreground">{field.label}</Label>
                          <p className="text-sm mt-0.5">{String(value)}</p>
                        </div>
                      );
                    }
                    return (
                      <DetailField
                        key={field.key}
                        label={field.label}
                        value={String(value)}
                      />
                    );
                  })}
                </div>
              </div>

              {partner.notes && (
                <div className="border-t border-border/50 pt-3">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-0.5">{partner.notes}</p>
                </div>
              )}

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

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}

function PartnerForm({
  category,
  initialData,
  onSubmit,
  isPending,
  onCancel,
}: {
  category: string;
  initialData?: Partnership;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  onCancel?: () => void;
}) {
  const fields = CATEGORY_FIELDS[category] || [];
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (initialData) {
      const d: Record<string, unknown> = {
        name: initialData.name,
        region: initialData.region || "",
        country: initialData.country || "",
        website: initialData.website || "",
        notes: initialData.notes || "",
      };
      for (const f of fields) {
        const val = (initialData as Record<string, unknown>)[f.key];
        if (f.type === "date" && val) {
          d[f.key] = new Date(val as string).toISOString().split("T")[0];
        } else if (f.type === "boolean") {
          d[f.key] = val ?? false;
        } else {
          d[f.key] = val ?? "";
        }
      }
      return d;
    }
    const d: Record<string, unknown> = { name: "", region: "", country: "", website: "", notes: "" };
    for (const f of fields) {
      d[f.key] = f.type === "boolean" ? false : "";
    }
    return d;
  });

  const handleChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(formData)) {
      if (v === "" || v === null || v === undefined) {
        cleaned[k] = null;
      } else {
        const fieldConfig = fields.find((f) => f.key === k);
        if (fieldConfig?.type === "number" && typeof v === "string") {
          cleaned[k] = v ? Number(v) : null;
        } else if (fieldConfig?.type === "date" && typeof v === "string") {
          cleaned[k] = v ? new Date(v).toISOString() : null;
        } else {
          cleaned[k] = v;
        }
      }
    }
    if (!cleaned.name) return;
    onSubmit(cleaned);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={(formData.name as string) || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            required
            data-testid="input-partner-name"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="region">Region</Label>
            <Input
              id="region"
              value={(formData.region as string) || ""}
              onChange={(e) => handleChange("region", e.target.value)}
              data-testid="input-partner-region"
            />
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={(formData.country as string) || ""}
              onChange={(e) => handleChange("country", e.target.value)}
              data-testid="input-partner-country"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            value={(formData.website as string) || ""}
            onChange={(e) => handleChange("website", e.target.value)}
            data-testid="input-partner-website"
          />
        </div>
      </div>

      <div className="border-t border-border/50 pt-3 space-y-3">
        <h3 className="text-sm font-medium">Category Fields</h3>
        {fields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key}>{field.label}</Label>
            {field.type === "select" && field.options ? (
              <Select
                value={(formData[field.key] as string) || ""}
                onValueChange={(v) => handleChange(field.key, v)}
              >
                <SelectTrigger data-testid={`select-${field.key}`}>
                  <SelectValue placeholder={`Select ${field.label}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <div className="flex items-center gap-2 mt-1">
                <Switch
                  id={field.key}
                  checked={!!formData[field.key]}
                  onCheckedChange={(v) => handleChange(field.key, v)}
                  data-testid={`switch-${field.key}`}
                />
                <Label htmlFor={field.key} className="text-sm text-muted-foreground">
                  {formData[field.key] ? "Yes" : "No"}
                </Label>
              </div>
            ) : field.type === "textarea" ? (
              <Textarea
                id={field.key}
                value={(formData[field.key] as string) || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                rows={3}
                data-testid={`textarea-${field.key}`}
              />
            ) : field.type === "date" ? (
              <Input
                id={field.key}
                type="date"
                value={(formData[field.key] as string) || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                data-testid={`input-${field.key}`}
              />
            ) : field.type === "number" ? (
              <Input
                id={field.key}
                type="number"
                value={(formData[field.key] as string) || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                data-testid={`input-${field.key}`}
              />
            ) : (
              <Input
                id={field.key}
                value={(formData[field.key] as string) || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                data-testid={`input-${field.key}`}
              />
            )}
          </div>
        ))}
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={(formData.notes as string) || ""}
          onChange={(e) => handleChange("notes", e.target.value)}
          rows={3}
          data-testid="textarea-partner-notes"
        />
      </div>

      <DialogFooter className="gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-form">
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending} data-testid="button-submit-partner">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initialData ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
