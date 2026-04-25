import './_group.css';
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Building2, MapPin, Globe, Zap, Star, Calendar, AlertTriangle,
  FolderPlus, ChevronRight, Mail, Phone, Plus, ArrowRightLeft, X,
  Users, Briefcase, LifeBuoy, History, FileText, MessageSquare,
  Clock, ChevronDown,
} from "lucide-react";

const account = {
  name: "Stillwater Yacht Harbour",
  segment: "marina",
  leadStatus: "qualified",
  priority: "high",
  legalName: "Stillwater Yacht Harbour Inc.",
  website: "stillwateryacht.ca",
  marinaType: "Saltwater · Full-service",
  ownershipType: "Family-owned",
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
  expansionNotes: "Adding 60 slips Phase 2, 2027",
  nextAction: "Send pilot proposal v2",
  notes: "Owner met us at boat show. Strong interest in metering + load mgmt.",
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

const emails = [
  { id: 1, from: "Marcus Chen", subject: "Re: Pilot proposal v2", time: "2h ago", snippet: "Looking great — Sarah wants the breakdown by panel…" },
  { id: 2, from: "You → Sarah Whitfield", subject: "Pilot proposal v2 attached", time: "Yesterday", snippet: "Hi Sarah, here is the updated proposal incorporating…" },
  { id: 3, from: "Diego Ramos", subject: "Site walkthrough photos", time: "3d ago", snippet: "Photos from the dock D walkthrough are here…" },
];

const timeline = [
  { id: 1, when: "2h ago", what: "Email received from Marcus Chen", icon: Mail },
  { id: 2, when: "Yesterday", what: "Quote v2 sent · $184,000", icon: FileText },
  { id: 3, when: "3d ago", what: "Stage moved Discovery → Proposal Sent", icon: ArrowRightLeft },
  { id: 4, when: "1w ago", what: "Note added: 'Owner wants pilot live by Aug 1'", icon: MessageSquare },
];

function DetailField({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</Label>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count }: { icon: React.ComponentType<{ className?: string }>; title: string; count?: number | string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {count !== undefined && <span className="text-xs text-muted-foreground">· {count}</span>}
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, count, defaultOpen = true, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number | string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/50 bg-card/30">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-medium">{title}</span>
          {count !== undefined && <span className="text-xs text-muted-foreground">· {count}</span>}
        </div>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Consolidated() {
  return (
    <div className="min-h-screen bg-black/40 p-3 sm:p-6">
      <div className="dark mx-auto max-w-3xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden">
        {/* Header — same as current */}
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
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">{account.segment}</Badge>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{account.leadStatus}</Badge>
                  <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">{account.priority}</Badge>
                  <span className="flex items-center gap-0.5 text-xs text-yellow-500">
                    <Star className="h-3 w-3" /> Pilot {account.pilotCandidateScore}/5
                  </span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><X className="h-4 w-4" /></Button>
          </div>

          {/* Quick action bar — keeps Edit / Folder / Comment up top so they aren't buried */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm">Edit</Button>
            <Button variant="outline" size="sm" className="text-teal-500 border-teal-500/30">
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Inbox Folder
            </Button>
            <Button variant="outline" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Contact
            </Button>
            <Button variant="outline" size="sm">
              <FileText className="h-3.5 w-3.5 mr-1.5" /> New Quote
            </Button>
          </div>
        </div>

        {/* 3 tabs instead of 8 — never wrap, always fit on mobile */}
        <div className="p-4 sm:p-6">
          <Tabs defaultValue="overview">
            <TabsList className="grid grid-cols-3 w-full bg-muted/40 p-1">
              <TabsTrigger value="overview" className="gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                <span>Overview</span>
              </TabsTrigger>
              <TabsTrigger value="people" className="gap-1.5">
                <Users className="h-3.5 w-3.5" />
                <span>People & Pipeline</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5">
                <History className="h-3.5 w-3.5" />
                <span>Activity</span>
              </TabsTrigger>
            </TabsList>

            {/* OVERVIEW = old Details + Notes + Infrastructure */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Label className="text-xs text-primary mb-1 block flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Next Action
                </Label>
                <p className="text-sm font-medium">{account.nextAction}</p>
                <p className="text-xs text-muted-foreground mt-1">Due: Apr 29, 2026 · Assigned to you</p>
              </div>

              <CollapsibleSection title="Address" icon={MapPin}>
                <div className="text-sm">
                  <p className="font-medium">{account.streetAddress}</p>
                  <p className="text-muted-foreground">{account.city}, {account.stateProvince}, {account.postalZip} · Canada</p>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Account profile" icon={Building2}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <DetailField label="Legal Name" value={account.legalName} />
                  <DetailField label="Website" value={account.website} icon={<Globe className="h-3 w-3" />} />
                  <DetailField label="Marina Type" value={account.marinaType} />
                  <DetailField label="Ownership" value={account.ownershipType} />
                  <DetailField label="Region" value={account.region} />
                  <DetailField label="Timezone" value={account.timezone} />
                  <DetailField label="Slip Count" value={String(account.slipCount)} />
                  <DetailField label="Slip Mix" value={account.slipMix} />
                  <DetailField label="Avg Boat Size" value={account.avgBoatSizeRange} />
                  <DetailField label="Seasonality" value={account.seasonality} />
                  <DetailField label="Lead Source" value={account.leadSource} />
                  <DetailField label="Tags" value={account.tags} />
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Infrastructure" icon={Zap} defaultOpen={false}>
                <div className="space-y-2">
                  <DetailField label="Power Demand" value={account.powerDemandIntensity} icon={<Zap className="h-3 w-3" />} />
                  <p className="text-xs text-muted-foreground italic">
                    Transformer specs, panel diagrams, breakers — full infrastructure profile form.
                  </p>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Notes & flags" icon={MessageSquare}>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <p className="text-sm mt-1">{account.notes}</p>
                  </div>
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-2">
                    <Label className="text-xs text-yellow-500 mb-1 block">Expansion Plans</Label>
                    <p className="text-sm">{account.expansionNotes}</p>
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Source lead" icon={ArrowRightLeft} defaultOpen={false}>
                <p className="text-xs text-muted-foreground">
                  Promoted from Lead #4421 · Boat Show Vancouver · 3 conversion events
                </p>
              </CollapsibleSection>
            </TabsContent>

            {/* PEOPLE & PIPELINE = old Contacts + Deals + Tickets */}
            <TabsContent value="people" className="space-y-4 mt-4">
              <section>
                <SectionHeader icon={Users} title="Contacts" count={contacts.length} />
                <div className="space-y-2">
                  {contacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                          {c.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            {c.isPrimary && <Badge variant="outline" className="text-[10px] px-1 py-0 bg-primary/10 text-primary border-primary/20">Primary</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{c.title} · {c.relationshipStrength}</p>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 text-muted-foreground shrink-0">
                        {c.email && <Mail className="h-3.5 w-3.5" />}
                        {c.phone && <Phone className="h-3.5 w-3.5" />}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionHeader icon={Briefcase} title="Deals" count={`${opps.length} · $${opps.reduce((s, o) => s + o.value, 0).toLocaleString()}`} />
                <div className="space-y-2">
                  {opps.map((o) => (
                    <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{o.title}</p>
                        <p className="text-xs text-muted-foreground">{o.stage}</p>
                      </div>
                      <span className="text-sm font-medium shrink-0">${o.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionHeader icon={LifeBuoy} title="Tickets" count={tickets.length} />
                <div className="space-y-2">
                  {tickets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.subject}</p>
                        <p className="text-xs text-muted-foreground">{t.category} · {t.severity}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">{t.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>
            </TabsContent>

            {/* ACTIVITY = old Emails + Timeline merged into one chronological feed */}
            <TabsContent value="activity" className="space-y-4 mt-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs">All</Button>
                <Button variant="ghost" size="sm" className="text-xs">Emails</Button>
                <Button variant="ghost" size="sm" className="text-xs">Events</Button>
                <Button variant="ghost" size="sm" className="text-xs">Notes</Button>
              </div>

              <section>
                <SectionHeader icon={Mail} title="Recent emails" count={emails.length} />
                <div className="space-y-2">
                  {emails.map((e) => (
                    <div key={e.id} className="p-3 rounded-lg border border-border/50">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium truncate">{e.subject}</p>
                        <span className="text-xs text-muted-foreground shrink-0">{e.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{e.from}</p>
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{e.snippet}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionHeader icon={Clock} title="Timeline" />
                <div className="space-y-3 pl-2 border-l-2 border-border/40">
                  {timeline.map((t) => (
                    <div key={t.id} className="flex items-start gap-3 -ml-[5px]">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <t.icon className="h-3 w-3 text-muted-foreground shrink-0" />
                          <p className="text-sm">{t.what}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.when}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
