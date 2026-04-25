import './_group.css';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Building2, MapPin, Globe, Zap, Star, Calendar, AlertTriangle,
  FolderPlus, ChevronRight, Mail, Phone, Link as LinkIcon, Plus,
  ArrowRightLeft, X
} from "lucide-react";

const account = {
  name: "Stillwater Yacht Harbour",
  segment: "marina",
  leadStatus: "qualified",
  priority: "high",
  orgType: "marina_operator",
  legalName: "Stillwater Yacht Harbour Inc.",
  website: "stillwateryacht.ca",
  marinaType: "Saltwater · Full-service",
  ownershipType: "Family-owned",
  parentCompany: "—",
  region: "BC South Coast",
  timezone: "America/Vancouver",
  slipCount: 320,
  slipMix: "70% wet · 30% dry",
  avgBoatSizeRange: "32–55 ft",
  powerDemandIntensity: "High (50A+)",
  seasonality: "Apr–Oct peak",
  leadSource: "Boat Show Vancouver",
  tags: "Pilot candidate, Tier-1",
  streetAddress: "2455 Harbour Rd",
  city: "Sidney",
  stateProvince: "BC",
  postalZip: "V8L 5G2",
  country: "CA",
  expansionPlans: true,
  expansionNotes: "Adding 60 slips Phase 2, 2027",
  redFlags: null,
  nextAction: "Send pilot proposal v2",
  nextActionAt: "2026-04-29",
  notes: "Owner met us at boat show. Strong interest in metering + load mgmt.",
  betaTester: true,
  pilotCandidateScore: 4,
};

const contacts = [
  { id: 1, name: "Marcus Chen", title: "Harbourmaster", email: "marcus@stillwateryacht.ca", phone: "+1 250 555 0144", isPrimary: true, relationshipStrength: "Champion" },
  { id: 2, name: "Sarah Whitfield", title: "Owner / GM", email: "sarah@stillwateryacht.ca", phone: "+1 250 555 0192", isPrimary: false, relationshipStrength: "Decision Maker" },
  { id: 3, name: "Diego Ramos", title: "Operations Lead", email: "diego@stillwateryacht.ca", phone: null, isPrimary: false, relationshipStrength: "Influencer" },
];

const opps = [
  { id: 1, title: "Pilot — 40 smart pedestals", stage: "Proposal Sent", value: 184000 },
  { id: 2, title: "Phase 2 expansion (60 slips)", stage: "Discovery", value: 410000 },
];

const tickets = [
  { id: 1, subject: "Pedestal #14 firmware unresponsive", category: "Hardware", severity: "P2", status: "Open" },
  { id: 2, subject: "Question on 50A breaker spec", category: "Pre-sales", severity: "P3", status: "Resolved" },
];

const segmentColors: Record<string, string> = {
  marina: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};
const statusColors: Record<string, string> = {
  qualified: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
};
const priorityColors: Record<string, string> = {
  high: "bg-red-500/10 text-red-500 border-red-500/20",
};

function DetailField({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</Label>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

export function Current() {
  return (
    <div className="min-h-screen bg-black/40 p-3 sm:p-6">
      <div className="dark mx-auto max-w-3xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold truncate">{account.name}</h2>
                  <button className="text-xs text-primary hover:underline shrink-0">Open ↗</button>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className={segmentColors[account.segment]}>{account.segment}</Badge>
                  <Badge variant="outline" className={statusColors[account.leadStatus]}>{account.leadStatus}</Badge>
                  <Badge variant="outline" className={priorityColors[account.priority]}>{account.priority}</Badge>
                  <Badge variant="outline">marina operator</Badge>
                  <button className="inline-flex items-center gap-1 text-xs rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 px-2 py-0.5">
                    <ArrowRightLeft className="h-3 w-3" />Promoted from Lead #4421
                  </button>
                  <Badge variant="outline" className="bg-cyan-500/10 text-cyan-500 border-cyan-500/20">Beta Tester</Badge>
                  <span className="flex items-center gap-0.5 text-xs text-yellow-500">
                    <Star className="h-3 w-3" /> Pilot Score: {account.pilotCandidateScore}/5
                  </span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><X className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <Tabs defaultValue="details">
            <TabsList className="flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
              <TabsTrigger value="opportunities">Deals ({opps.length})</TabsTrigger>
              <TabsTrigger value="tickets">Tickets ({tickets.length})</TabsTrigger>
              <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>
              <TabsTrigger value="emails">Emails</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="text-teal-500 border-teal-500/30">
                  <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Create Inbox Folder
                </Button>
                <Button variant="outline" size="sm">Edit</Button>
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Address</Label>
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium">{account.streetAddress}</p>
                    <p className="text-muted-foreground">{account.city}, {account.stateProvince}, {account.postalZip} Canada</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <DetailField label="Organization Type" value="Marina Operator" />
                <DetailField label="Legal Name" value={account.legalName} />
                <DetailField label="Website" value={account.website} icon={<Globe className="h-3 w-3" />} />
                <DetailField label="Marina Type" value={account.marinaType} />
                <DetailField label="Ownership" value={account.ownershipType} />
                <DetailField label="Region" value={account.region} />
                <DetailField label="Timezone" value={account.timezone} />
                <DetailField label="Slip Count" value={String(account.slipCount)} />
                <DetailField label="Slip Mix" value={account.slipMix} />
                <DetailField label="Avg Boat Size" value={account.avgBoatSizeRange} />
                <DetailField label="Power Demand" value={account.powerDemandIntensity} icon={<Zap className="h-3 w-3" />} />
                <DetailField label="Seasonality" value={account.seasonality} />
                <DetailField label="Lead Source" value={account.leadSource} />
                <DetailField label="Tags" value={account.tags} />
              </div>

              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                <Label className="text-xs text-yellow-500 mb-1 block">Expansion Plans</Label>
                <p className="text-sm">{account.expansionNotes}</p>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Label className="text-xs text-primary mb-1 block flex items-center gap-1"><Calendar className="h-3 w-3" /> Next Action</Label>
                <p className="text-sm font-medium">{account.nextAction}</p>
                <p className="text-xs text-muted-foreground mt-1">Due: Apr 29, 2026</p>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <p className="text-sm">{account.notes}</p>
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <Label className="text-xs text-muted-foreground mb-2 block">Assigned To</Label>
                <div className="text-sm">Trevor Voltsafe (you)</div>
              </div>

              <div className="border-t border-emerald-500/20 pt-4">
                <button className="flex items-center gap-2 w-full text-left mb-3">
                  <ChevronRight className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Source Lead</span>
                  <span className="text-xs text-muted-foreground">· Lead #4421</span>
                </button>
              </div>

              <div className="border-t border-border/50 pt-4">
                <Label className="text-xs text-muted-foreground mb-2 block">Attachments</Label>
                <p className="text-sm text-muted-foreground italic">No attachments yet</p>
              </div>

              <div className="border-t border-border/50 pt-4">
                <Label className="text-xs text-muted-foreground mb-2 block">Comments</Label>
                <p className="text-sm text-muted-foreground italic">Be the first to comment…</p>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-4">
              <div className="flex justify-end mb-3">
                <Button size="sm" variant="outline"><Plus className="mr-1 h-3 w-3" /> Add Contact</Button>
              </div>
              <div className="space-y-2">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{c.name.charAt(0)}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{c.name}</p>
                          {c.isPrimary && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-primary/10 text-primary border-primary/20">Primary</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{c.title} · {c.relationshipStrength}</p>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-sm text-muted-foreground">
                      {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>}
                      <LinkIcon className="h-3 w-3" />
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="opportunities" className="mt-4">
              <div className="space-y-2">
                {opps.map((o) => (
                  <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                    <div>
                      <p className="text-sm font-medium">{o.title}</p>
                      <p className="text-xs text-muted-foreground">Stage: {o.stage}</p>
                    </div>
                    <span className="text-sm font-medium">${o.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="tickets" className="mt-4">
              <div className="space-y-2">
                {tickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                    <div>
                      <p className="text-sm font-medium">{t.subject}</p>
                      <p className="text-xs text-muted-foreground">{t.category} · {t.severity}</p>
                    </div>
                    <Badge variant="outline">{t.status}</Badge>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="infrastructure" className="mt-4">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-sm text-muted-foreground italic flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" /> Infrastructure profile form (transformer specs, panel diagrams, breakers, etc.).
                </p>
              </div>
            </TabsContent>

            <TabsContent value="emails" className="mt-4">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-sm text-muted-foreground italic">Email thread list for this account.</p>
              </div>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-sm text-muted-foreground italic">Notes panel.</p>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <div className="rounded-lg border border-border/50 p-4">
                <p className="text-sm text-muted-foreground italic">Timeline of all activity on this account.</p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
