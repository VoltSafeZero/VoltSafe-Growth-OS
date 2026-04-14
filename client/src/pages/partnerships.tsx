import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, Loader2, Globe, MapPin, Pencil, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type { Partnership } from "@shared/schema";

const INDUSTRY_TYPES = [
  "Industry & Associations",
  "Govt & Public Sector",
  "Channel Partners",
  "Manufacturing",
  "Innovation & Research",
  "Media & Tradeshows",
  "Other",
] as const;

type IndustryType = typeof INDUSTRY_TYPES[number];

const SLUG_TO_TYPE: Record<string, IndustryType> = {
  "industry-associations": "Industry & Associations",
  "government-public": "Govt & Public Sector",
  "channel-commercial": "Channel Partners",
  "manufacturing": "Manufacturing",
  "innovation-research": "Innovation & Research",
  "media-tradeshows": "Media & Tradeshows",
  "other": "Other",
};

const TYPE_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_TYPE).map(([slug, type]) => [type, slug])
);

const TYPE_COLORS: Record<string, string> = {
  "Industry & Associations": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Govt & Public Sector": "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Channel Partners": "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  "Manufacturing": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "Innovation & Research": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  "Media & Tradeshows": "bg-pink-500/10 text-pink-400 border-pink-500/20",
  "Other": "bg-gray-500/10 text-gray-400 border-gray-500/20",
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
  // Core
  name: string; organizationType: string; region: string; country: string; website: string; industryTypes: string[];
  // Relationship
  strategicImportance: string; priorityLevel: string; participationStatus: string; membershipStatus: string; contractStatus: string; startDate: string; endDate: string;
  // Contacts & Engagement
  keyContacts: string; influenceScore: string; marinasRepresented: string; eventsHosted: string; speakingOpportunities: string;
  // Business & Revenue
  territory: string; channelType: string; salesReach: string; activeOpportunities: string; expectedRevenuePotential: string; revenueGenerated: string; dealRegistrationEnabled: boolean;
  // Technology & Integration
  technologyCategory: string; integrationStatus: string; apiAvailable: boolean; integrationType: string; technicalContact: string; integrationDocLink: string; jointRoadmapNotes: string;
  // Research & Innovation
  institutionType: string; researchFocus: string; programName: string; projectDescription: string; keyResearchers: string; ipConsiderations: string;
  // Government & Grants
  agencyBody: string; grantType: string; fundingAmount: string; applicationStatus: string; deliverables: string; reportingRequirements: string;
  // Pilot & Deployment
  pilotStatus: string; slipCount: string; deploymentSize: string; productVersionInstalled: string; caseStudyStatus: string; testimonialStatus: string; operationalFeedback: string;
  // Notes
  notes: string;
}

function emptyForm(): FormState {
  return {
    name: "", organizationType: "", region: "", country: "", website: "", industryTypes: [],
    strategicImportance: "", priorityLevel: "", participationStatus: "", membershipStatus: "", contractStatus: "", startDate: "", endDate: "",
    keyContacts: "", influenceScore: "", marinasRepresented: "", eventsHosted: "", speakingOpportunities: "",
    territory: "", channelType: "", salesReach: "", activeOpportunities: "", expectedRevenuePotential: "", revenueGenerated: "", dealRegistrationEnabled: false,
    technologyCategory: "", integrationStatus: "", apiAvailable: false, integrationType: "", technicalContact: "", integrationDocLink: "", jointRoadmapNotes: "",
    institutionType: "", researchFocus: "", programName: "", projectDescription: "", keyResearchers: "", ipConsiderations: "",
    agencyBody: "", grantType: "", fundingAmount: "", applicationStatus: "", deliverables: "", reportingRequirements: "",
    pilotStatus: "", slipCount: "", deploymentSize: "", productVersionInstalled: "", caseStudyStatus: "", testimonialStatus: "", operationalFeedback: "",
    notes: "",
  };
}

function formFromPartner(p: Partnership): FormState {
  return {
    name: p.name, organizationType: p.organizationType || "", region: p.region || "", country: p.country || "", website: p.website || "", industryTypes: p.industryTypes || [],
    strategicImportance: p.strategicImportance || "", priorityLevel: p.priorityLevel || "", participationStatus: p.participationStatus || "", membershipStatus: p.membershipStatus || "", contractStatus: p.contractStatus || "",
    startDate: p.startDate ? String(p.startDate).slice(0, 10) : "", endDate: p.endDate ? String(p.endDate).slice(0, 10) : "",
    keyContacts: p.keyContacts || "", influenceScore: p.influenceScore != null ? String(p.influenceScore) : "", marinasRepresented: p.marinasRepresented != null ? String(p.marinasRepresented) : "", eventsHosted: p.eventsHosted || "", speakingOpportunities: p.speakingOpportunities || "",
    territory: p.territory || "", channelType: p.channelType || "", salesReach: p.salesReach != null ? String(p.salesReach) : "", activeOpportunities: p.activeOpportunities != null ? String(p.activeOpportunities) : "", expectedRevenuePotential: p.expectedRevenuePotential || "", revenueGenerated: p.revenueGenerated != null ? String(p.revenueGenerated) : "", dealRegistrationEnabled: p.dealRegistrationEnabled || false,
    technologyCategory: p.technologyCategory || "", integrationStatus: p.integrationStatus || "", apiAvailable: p.apiAvailable || false, integrationType: p.integrationType || "", technicalContact: p.technicalContact || "", integrationDocLink: p.integrationDocLink || "", jointRoadmapNotes: p.jointRoadmapNotes || "",
    institutionType: p.institutionType || "", researchFocus: p.researchFocus || "", programName: p.programName || "", projectDescription: p.projectDescription || "", keyResearchers: p.keyResearchers || "", ipConsiderations: p.ipConsiderations || "",
    agencyBody: p.agencyBody || "", grantType: p.grantType || "", fundingAmount: p.fundingAmount != null ? String(p.fundingAmount) : "", applicationStatus: p.applicationStatus || "", deliverables: p.deliverables || "", reportingRequirements: p.reportingRequirements || "",
    pilotStatus: p.pilotStatus || "", slipCount: p.slipCount != null ? String(p.slipCount) : "", deploymentSize: p.deploymentSize != null ? String(p.deploymentSize) : "", productVersionInstalled: p.productVersionInstalled || "", caseStudyStatus: p.caseStudyStatus || "", testimonialStatus: p.testimonialStatus || "", operationalFeedback: p.operationalFeedback || "",
    notes: p.notes || "",
  };
}

function formToPayload(data: FormState, extra: Record<string, unknown> = {}) {
  return {
    ...data, ...extra,
    industryTypes: data.industryTypes.length > 0 ? data.industryTypes : null,
    influenceScore: data.influenceScore ? parseInt(data.influenceScore) : null,
    marinasRepresented: data.marinasRepresented ? parseInt(data.marinasRepresented) : null,
    salesReach: data.salesReach ? parseInt(data.salesReach) : null,
    activeOpportunities: data.activeOpportunities ? parseInt(data.activeOpportunities) : null,
    revenueGenerated: data.revenueGenerated ? parseFloat(data.revenueGenerated) : null,
    fundingAmount: data.fundingAmount ? parseFloat(data.fundingAmount) : null,
    slipCount: data.slipCount ? parseInt(data.slipCount) : null,
    deploymentSize: data.deploymentSize ? parseInt(data.deploymentSize) : null,
    startDate: data.startDate || null, endDate: data.endDate || null,
    organizationType: data.organizationType || null, region: data.region || null, country: data.country || null, website: data.website || null,
    strategicImportance: data.strategicImportance || null, priorityLevel: data.priorityLevel || null, participationStatus: data.participationStatus || null,
    membershipStatus: data.membershipStatus || null, contractStatus: data.contractStatus || null, keyContacts: data.keyContacts || null,
    eventsHosted: data.eventsHosted || null, speakingOpportunities: data.speakingOpportunities || null, territory: data.territory || null,
    channelType: data.channelType || null, expectedRevenuePotential: data.expectedRevenuePotential || null,
    technologyCategory: data.technologyCategory || null, integrationStatus: data.integrationStatus || null, integrationType: data.integrationType || null,
    technicalContact: data.technicalContact || null, integrationDocLink: data.integrationDocLink || null, jointRoadmapNotes: data.jointRoadmapNotes || null,
    institutionType: data.institutionType || null, researchFocus: data.researchFocus || null, programName: data.programName || null,
    projectDescription: data.projectDescription || null, keyResearchers: data.keyResearchers || null, ipConsiderations: data.ipConsiderations || null,
    agencyBody: data.agencyBody || null, grantType: data.grantType || null, applicationStatus: data.applicationStatus || null,
    deliverables: data.deliverables || null, reportingRequirements: data.reportingRequirements || null,
    pilotStatus: data.pilotStatus || null, productVersionInstalled: data.productVersionInstalled || null,
    caseStudyStatus: data.caseStudyStatus || null, testimonialStatus: data.testimonialStatus || null, operationalFeedback: data.operationalFeedback || null,
    notes: data.notes || null,
  };
}

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 mt-4 hover:text-foreground transition-colors"
    >
      {title}
      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function PartnerForm({ initialData, onSubmit, isPending, onCancel }: {
  initialData?: Partnership;
  onSubmit: (data: FormState) => void;
  isPending: boolean;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(initialData ? formFromPartner(initialData) : emptyForm());
  const [open, setOpen] = useState({ contacts: false, business: false, tech: false, research: false, govt: false, pilot: false });
  const set = (k: keyof FormState, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  const tog = (k: keyof typeof open) => setOpen((p) => ({ ...p, [k]: !p[k] }));
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (!form.name.trim()) return; onSubmit(form); };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">

      {/* ── CORE ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <Label htmlFor="pf-name">Organization Name *</Label>
          <Input id="pf-name" value={form.name} onChange={(e) => set("name", e.target.value)} required data-testid="input-partner-name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pf-orgtype">Organization Type</Label>
            <Select value={form.organizationType} onValueChange={(v) => set("organizationType", v)}>
              <SelectTrigger id="pf-orgtype" data-testid="select-org-type"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {["Association","Standards Body","AHJ","Government Agency","Military / Defense","Distributor","Reseller","Installation Partner","Manufacturer","Utility Provider","Research Institution","Accelerator / Incubator","Consultant","Advisory Firm","Media / Press","Nonprofit","Other"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pf-website">Website</Label>
            <Input id="pf-website" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" data-testid="input-partner-website" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pf-region">Region / Province</Label>
            <Input id="pf-region" value={form.region} onChange={(e) => set("region", e.target.value)} data-testid="input-partner-region" />
          </div>
          <div>
            <Label htmlFor="pf-country">Country</Label>
            <Input id="pf-country" value={form.country} onChange={(e) => set("country", e.target.value)} data-testid="input-partner-country" />
          </div>
        </div>
        <div>
          <Label className="block mb-2">Industry Category <span className="text-muted-foreground font-normal">(select one or more)</span></Label>
          <IndustryTypePicker selected={form.industryTypes} onChange={(v) => set("industryTypes", v)} />
        </div>
      </div>

      {/* ── RELATIONSHIP & STATUS ─────────────────────────── */}
      <div className="border-t border-border/50 pt-3 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Relationship & Status</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Strategic Importance</Label>
            <Select value={form.strategicImportance} onValueChange={(v) => set("strategicImportance", v)}>
              <SelectTrigger data-testid="select-strategic-importance"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["Low","Medium","High","Critical"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority Level</Label>
            <Select value={form.priorityLevel} onValueChange={(v) => set("priorityLevel", v)}>
              <SelectTrigger data-testid="select-priority-level"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["Low","Medium","High"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Partnership Status</Label>
            <Select value={form.participationStatus} onValueChange={(v) => set("participationStatus", v)}>
              <SelectTrigger data-testid="select-participation-status"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["Prospect","Active","On Hold","Inactive","Dormant"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Membership Status</Label>
            <Select value={form.membershipStatus} onValueChange={(v) => set("membershipStatus", v)}>
              <SelectTrigger data-testid="select-membership-status"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["None","Member","Sponsor","Board Member","Advisory Board"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Agreement / Contract</Label>
            <Select value={form.contractStatus} onValueChange={(v) => set("contractStatus", v)}>
              <SelectTrigger data-testid="select-contract-status"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["None","MOU","NDA","Letter of Intent","Formal Agreement","Expired"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="pf-start">Start Date</Label>
              <Input id="pf-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} data-testid="input-partner-start-date" />
            </div>
            <div>
              <Label htmlFor="pf-end">End Date</Label>
              <Input id="pf-end" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} data-testid="input-partner-end-date" />
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTACTS & ENGAGEMENT (collapsible) ─────────── */}
      <SectionHeader title="Contacts & Engagement" open={open.contacts} onToggle={() => tog("contacts")} />
      {open.contacts && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="pf-contacts">Key Contacts <span className="text-muted-foreground font-normal text-xs">(names, emails, roles)</span></Label>
            <Textarea id="pf-contacts" value={form.keyContacts} onChange={(e) => set("keyContacts", e.target.value)} rows={2} placeholder="e.g. Jane Smith, Executive Director, jane@org.com" data-testid="input-partner-key-contacts" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="pf-influence">Influence Score <span className="text-xs text-muted-foreground">(1–10)</span></Label>
              <Input id="pf-influence" type="number" min="1" max="10" value={form.influenceScore} onChange={(e) => set("influenceScore", e.target.value)} data-testid="input-partner-influence-score" />
            </div>
            <div>
              <Label htmlFor="pf-marinas">Marinas Represented</Label>
              <Input id="pf-marinas" type="number" value={form.marinasRepresented} onChange={(e) => set("marinasRepresented", e.target.value)} data-testid="input-partner-marinas-represented" />
            </div>
            <div>
              <Label htmlFor="pf-events">Events Hosted / yr</Label>
              <Input id="pf-events" value={form.eventsHosted} onChange={(e) => set("eventsHosted", e.target.value)} data-testid="input-partner-events-hosted" />
            </div>
          </div>
          <div>
            <Label>Speaking Opportunities</Label>
            <Select value={form.speakingOpportunities} onValueChange={(v) => set("speakingOpportunities", v)}>
              <SelectTrigger data-testid="select-speaking-opportunities"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["Yes","No","Pending","Past"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ── BUSINESS & REVENUE (collapsible) ────────────── */}
      <SectionHeader title="Business & Revenue" open={open.business} onToggle={() => tog("business")} />
      {open.business && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-territory">Territory</Label>
              <Input id="pf-territory" value={form.territory} onChange={(e) => set("territory", e.target.value)} placeholder="e.g. Western Canada" data-testid="input-partner-territory" />
            </div>
            <div>
              <Label>Channel Type</Label>
              <Select value={form.channelType} onValueChange={(v) => set("channelType", v)}>
                <SelectTrigger data-testid="select-channel-type"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["Distributor","Reseller","VAR","Installer","OEM","Referral Partner","Other"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="pf-salesreach">Sales Reach</Label>
              <Input id="pf-salesreach" type="number" value={form.salesReach} onChange={(e) => set("salesReach", e.target.value)} placeholder="# customers" data-testid="input-partner-sales-reach" />
            </div>
            <div>
              <Label htmlFor="pf-activeopps">Active Opportunities</Label>
              <Input id="pf-activeopps" type="number" value={form.activeOpportunities} onChange={(e) => set("activeOpportunities", e.target.value)} data-testid="input-partner-active-opportunities" />
            </div>
            <div>
              <Label htmlFor="pf-revenue">Revenue Generated ($)</Label>
              <Input id="pf-revenue" type="number" value={form.revenueGenerated} onChange={(e) => set("revenueGenerated", e.target.value)} data-testid="input-partner-revenue-generated" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Revenue Potential</Label>
              <Select value={form.expectedRevenuePotential} onValueChange={(v) => set("expectedRevenuePotential", v)}>
                <SelectTrigger data-testid="select-revenue-potential"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["None","Low","Medium","High","Very High"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Checkbox id="pf-dealreg" checked={form.dealRegistrationEnabled} onCheckedChange={(v) => set("dealRegistrationEnabled", !!v)} data-testid="checkbox-deal-registration" />
              <Label htmlFor="pf-dealreg" className="cursor-pointer">Deal Registration Enabled</Label>
            </div>
          </div>
        </div>
      )}

      {/* ── TECHNOLOGY & INTEGRATION (collapsible) ──────── */}
      <SectionHeader title="Technology & Integration" open={open.tech} onToggle={() => tog("tech")} />
      {open.tech && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-techcat">Technology Category</Label>
              <Input id="pf-techcat" value={form.technologyCategory} onChange={(e) => set("technologyCategory", e.target.value)} placeholder="e.g. Power Management" data-testid="input-partner-tech-category" />
            </div>
            <div>
              <Label>Integration Status</Label>
              <Select value={form.integrationStatus} onValueChange={(v) => set("integrationStatus", v)}>
                <SelectTrigger data-testid="select-integration-status"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["None","Planned","In Progress","Integrated","Deprecated"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-integtype">Integration Type</Label>
              <Input id="pf-integtype" value={form.integrationType} onChange={(e) => set("integrationType", e.target.value)} placeholder="e.g. REST API, SDK" data-testid="input-partner-integration-type" />
            </div>
            <div>
              <Label htmlFor="pf-techcontact">Technical Contact</Label>
              <Input id="pf-techcontact" value={form.technicalContact} onChange={(e) => set("technicalContact", e.target.value)} data-testid="input-partner-technical-contact" />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-integdoc">Integration Doc Link</Label>
            <Input id="pf-integdoc" value={form.integrationDocLink} onChange={(e) => set("integrationDocLink", e.target.value)} placeholder="https://" data-testid="input-partner-integration-doc" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="pf-api" checked={form.apiAvailable} onCheckedChange={(v) => set("apiAvailable", !!v)} data-testid="checkbox-api-available" />
            <Label htmlFor="pf-api" className="cursor-pointer">API Available</Label>
          </div>
          <div>
            <Label htmlFor="pf-roadmap">Joint Roadmap Notes</Label>
            <Textarea id="pf-roadmap" value={form.jointRoadmapNotes} onChange={(e) => set("jointRoadmapNotes", e.target.value)} rows={2} data-testid="textarea-partner-roadmap-notes" />
          </div>
        </div>
      )}

      {/* ── RESEARCH & INNOVATION (collapsible) ─────────── */}
      <SectionHeader title="Research & Innovation" open={open.research} onToggle={() => tog("research")} />
      {open.research && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Institution Type</Label>
              <Select value={form.institutionType} onValueChange={(v) => set("institutionType", v)}>
                <SelectTrigger data-testid="select-institution-type"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["University","Research Lab","Accelerator","Incubator","Think Tank","Standards Body","Other"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pf-program">Program Name</Label>
              <Input id="pf-program" value={form.programName} onChange={(e) => set("programName", e.target.value)} data-testid="input-partner-program-name" />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-research-focus">Research Focus</Label>
            <Input id="pf-research-focus" value={form.researchFocus} onChange={(e) => set("researchFocus", e.target.value)} placeholder="e.g. Marine electrification, EV charging" data-testid="input-partner-research-focus" />
          </div>
          <div>
            <Label htmlFor="pf-projdesc">Project Description</Label>
            <Textarea id="pf-projdesc" value={form.projectDescription} onChange={(e) => set("projectDescription", e.target.value)} rows={2} data-testid="textarea-partner-project-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-researchers">Key Researchers</Label>
              <Input id="pf-researchers" value={form.keyResearchers} onChange={(e) => set("keyResearchers", e.target.value)} data-testid="input-partner-key-researchers" />
            </div>
            <div>
              <Label htmlFor="pf-ip">IP Considerations</Label>
              <Input id="pf-ip" value={form.ipConsiderations} onChange={(e) => set("ipConsiderations", e.target.value)} placeholder="e.g. Joint IP, VoltSafe owns" data-testid="input-partner-ip-considerations" />
            </div>
          </div>
        </div>
      )}

      {/* ── GOVERNMENT & GRANTS (collapsible) ───────────── */}
      <SectionHeader title="Government & Grants" open={open.govt} onToggle={() => tog("govt")} />
      {open.govt && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-agency">Agency / Body</Label>
              <Input id="pf-agency" value={form.agencyBody} onChange={(e) => set("agencyBody", e.target.value)} data-testid="input-partner-agency-body" />
            </div>
            <div>
              <Label htmlFor="pf-granttype">Grant Type</Label>
              <Input id="pf-granttype" value={form.grantType} onChange={(e) => set("grantType", e.target.value)} placeholder="e.g. Subsidy, R&D Grant" data-testid="input-partner-grant-type" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-funding">Funding Amount ($)</Label>
              <Input id="pf-funding" type="number" value={form.fundingAmount} onChange={(e) => set("fundingAmount", e.target.value)} data-testid="input-partner-funding-amount" />
            </div>
            <div>
              <Label>Application Status</Label>
              <Select value={form.applicationStatus} onValueChange={(v) => set("applicationStatus", v)}>
                <SelectTrigger data-testid="select-application-status"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["Not Started","In Progress","Submitted","Under Review","Approved","Rejected","Closed"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="pf-deliverables">Deliverables</Label>
            <Textarea id="pf-deliverables" value={form.deliverables} onChange={(e) => set("deliverables", e.target.value)} rows={2} data-testid="textarea-partner-deliverables" />
          </div>
          <div>
            <Label htmlFor="pf-reporting">Reporting Requirements</Label>
            <Textarea id="pf-reporting" value={form.reportingRequirements} onChange={(e) => set("reportingRequirements", e.target.value)} rows={2} data-testid="textarea-partner-reporting-requirements" />
          </div>
        </div>
      )}

      {/* ── PILOT & DEPLOYMENT (collapsible) ────────────── */}
      <SectionHeader title="Pilot & Deployment" open={open.pilot} onToggle={() => tog("pilot")} />
      {open.pilot && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Pilot Status</Label>
              <Select value={form.pilotStatus} onValueChange={(v) => set("pilotStatus", v)}>
                <SelectTrigger data-testid="select-pilot-status"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["None","Proposed","Planning","Active","Complete","On Hold"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pf-slips">Slip Count</Label>
              <Input id="pf-slips" type="number" value={form.slipCount} onChange={(e) => set("slipCount", e.target.value)} data-testid="input-partner-slip-count" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-deployment">Deployment Size (units)</Label>
              <Input id="pf-deployment" type="number" value={form.deploymentSize} onChange={(e) => set("deploymentSize", e.target.value)} data-testid="input-partner-deployment-size" />
            </div>
            <div>
              <Label htmlFor="pf-version">Product Version Installed</Label>
              <Input id="pf-version" value={form.productVersionInstalled} onChange={(e) => set("productVersionInstalled", e.target.value)} data-testid="input-partner-product-version" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Case Study Status</Label>
              <Select value={form.caseStudyStatus} onValueChange={(v) => set("caseStudyStatus", v)}>
                <SelectTrigger data-testid="select-case-study-status"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["None","Planned","In Progress","Published"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Testimonial Status</Label>
              <Select value={form.testimonialStatus} onValueChange={(v) => set("testimonialStatus", v)}>
                <SelectTrigger data-testid="select-testimonial-status"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {["None","Requested","Received","Published"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="pf-opfeedback">Operational Feedback</Label>
            <Textarea id="pf-opfeedback" value={form.operationalFeedback} onChange={(e) => set("operationalFeedback", e.target.value)} rows={2} data-testid="textarea-partner-operational-feedback" />
          </div>
        </div>
      )}

      {/* ── NOTES ────────────────────────────────────────── */}
      <div className="border-t border-border/50 pt-3">
        <Label htmlFor="pf-notes">Notes</Label>
        <Textarea id="pf-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="General notes, context, history..." data-testid="textarea-partner-notes" />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={isPending || !form.name.trim()} className="ml-auto" data-testid="button-submit-partner">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {initialData ? "Save Changes" : "Create Partner"}
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
  canEdit = true,
}: {
  partner: Partnership;
  onClose: () => void;
  onUpdate: (data: FormState) => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
  canEdit?: boolean;
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

              {canEdit && (
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
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PartnershipsPage({ typeSlug = "", canEdit = true }: { typeSlug?: string; canEdit?: boolean }) {
  const initialType: IndustryType | "all" = SLUG_TO_TYPE[typeSlug] || "all";
  const [search, setSearch] = useState("");
  const [filterImportance, setFilterImportance] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterOrgType, setFilterOrgType] = useState("all");
  const [filterCountry, setFilterCountry] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [activeType, setActiveType] = useState<IndustryType | "all">(initialType);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Partnership | null>(null);
  const { toast } = useToast();

  // Sync activeType when the slug changes (user clicks sidebar)
  useEffect(() => {
    setActiveType(SLUG_TO_TYPE[typeSlug] || "all");
  }, [typeSlug]);

  // Deep-link: /strategy/partnerships?selected={id} opens the partner dialog
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    if (!selectedId) return;
    fetch(`/api/partnerships/${selectedId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(partner => { if (partner) setSelectedPartner(partner); })
      .catch(() => {});
  }, []);

  const { data: allPartners, isLoading } = useQuery<Partnership[]>({
    queryKey: ["/api/partnerships", { industryType: activeType === "all" ? undefined : activeType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeType !== "all") params.set("industryType", activeType);
      const res = await fetch(`/api/partnerships?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  // Derive unique filter options from actual data
  const countryOptions = useMemo(() => {
    if (!allPartners) return [];
    return [...new Set(allPartners.map((p) => p.country).filter(Boolean) as string[])].sort();
  }, [allPartners]);

  const orgTypeOptions = useMemo(() => {
    if (!allPartners) return [];
    return [...new Set(allPartners.map((p) => p.organizationType).filter(Boolean) as string[])].sort();
  }, [allPartners]);

  const hasActiveFilters = filterImportance !== "all" || filterStatus !== "all" || filterOrgType !== "all" || filterCountry !== "all" || search.trim() !== "";

  const clearFilters = () => {
    setSearch(""); setFilterImportance("all"); setFilterStatus("all"); setFilterOrgType("all"); setFilterCountry("all");
  };

  const IMPORTANCE_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  const filtered = useMemo(() => {
    if (!allPartners) return [];
    let list = [...allPartners];

    // Text search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.name, p.notes, p.region, p.country, p.website, p.keyContacts, p.organizationType,
         p.membershipStatus, p.strategicImportance, p.territory, p.channelType,
         p.technologyCategory, p.researchFocus, p.programName, p.agencyBody,
         ...(p.industryTypes || [])].some((f) => f && String(f).toLowerCase().includes(q))
      );
    }

    // Dropdown filters
    if (filterImportance !== "all") list = list.filter((p) => p.strategicImportance === filterImportance);
    if (filterStatus !== "all") list = list.filter((p) => p.participationStatus === filterStatus);
    if (filterOrgType !== "all") list = list.filter((p) => p.organizationType === filterOrgType);
    if (filterCountry !== "all") list = list.filter((p) => p.country === filterCountry);

    // Sort
    list.sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      if (sortBy === "importance") return (IMPORTANCE_ORDER[a.strategicImportance || ""] ?? 9) - (IMPORTANCE_ORDER[b.strategicImportance || ""] ?? 9);
      if (sortBy === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return 0;
    });

    return list;
  }, [allPartners, search, filterImportance, filterStatus, filterOrgType, filterCountry, sortBy]);

  const createMutation = useMutation({
    mutationFn: async (data: FormState) => {
      const payload = formToPayload(data, { category: "all_partnerships" });
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
      const payload = formToPayload(data);
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
        {canEdit && <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
        </Dialog>}
      </div>

      {/* Search + Filters */}
      <div className="space-y-2">
        {/* Row 1: text search + result count */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, notes, region, contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-partners"
            />
          </div>
          {!isLoading && (
            <span className="text-xs text-muted-foreground shrink-0">
              {filtered.length} {filtered.length === 1 ? "partner" : "partners"}
            </span>
          )}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground h-8 px-2 gap-1" data-testid="button-clear-filters">
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>

        {/* Row 2: dropdown filters + sort */}
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

          {/* Strategic Importance */}
          <Select value={filterImportance} onValueChange={setFilterImportance}>
            <SelectTrigger className={`h-8 text-xs w-auto min-w-[148px] ${filterImportance !== "all" ? "border-primary text-primary" : ""}`} data-testid="filter-importance">
              <SelectValue placeholder="Importance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Importances</SelectItem>
              {["Critical","High","Medium","Low"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Partnership Status */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className={`h-8 text-xs w-auto min-w-[148px] ${filterStatus !== "all" ? "border-primary text-primary" : ""}`} data-testid="filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["Prospect","Active","On Hold","Inactive","Dormant"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Organization Type — dynamic from data */}
          <Select value={filterOrgType} onValueChange={setFilterOrgType}>
            <SelectTrigger className={`h-8 text-xs w-auto min-w-[148px] ${filterOrgType !== "all" ? "border-primary text-primary" : ""}`} data-testid="filter-org-type">
              <SelectValue placeholder="Org Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Org Types</SelectItem>
              {orgTypeOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Country — dynamic from data */}
          <Select value={filterCountry} onValueChange={setFilterCountry}>
            <SelectTrigger className={`h-8 text-xs w-auto min-w-[120px] ${filterCountry !== "all" ? "border-primary text-primary" : ""}`} data-testid="filter-country">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countryOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[148px] ml-auto" data-testid="sort-partners">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A → Z</SelectItem>
              <SelectItem value="name-desc">Name Z → A</SelectItem>
              <SelectItem value="importance">Strategic Importance</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Partners grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((partner) => (
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
          {filtered.length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground" data-testid="text-empty-state">
              {search.trim()
                ? `No partners match "${search}".`
                : activeType === "all"
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
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
