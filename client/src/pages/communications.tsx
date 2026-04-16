import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, List, FileEdit, Send, Users, Megaphone } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import type { CommunicationList, CampaignDraft } from "@shared/schema";

const campaignStatusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sent: "bg-green-500/10 text-green-400 border-green-500/20",
  logged: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

export default function CommunicationsPage() {
  const [createListOpen, setCreateListOpen] = useState(false);
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const { toast } = useToast();

  const { data: listsData } = useQuery<CommunicationList[]>({
    queryKey: ["/api/comm-lists"],
  });

  const { data: campaignsData } = useQuery<CampaignDraft[]>({
    queryKey: ["/api/campaigns"],
  });

  const createListMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/comm-lists", d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comm-lists"] });
      setCreateListOpen(false);
      toast({ title: "List created" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to create list", variant: "destructive" }); },
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/campaigns", d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      setCreateCampaignOpen(false);
      toast({ title: "Campaign draft created" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to create campaign", variant: "destructive" }); },
  });

  const updateCampaignMutation = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; [key: string]: unknown }) => {
      const res = await apiRequest("PUT", `/api/campaigns/${id}`, d);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign updated" });
    },
    onError: (err: any) => { toast({ title: "Error", description: err?.message || "Failed to update campaign", variant: "destructive" }); },
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">Communications</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage broadcast lists and campaign drafts.</p>
      </div>

      <Tabs defaultValue="lists">
        <TabsList>
          <TabsTrigger value="lists" data-testid="tab-lists"><Users className="h-4 w-4 mr-2" /> Lists</TabsTrigger>
          <TabsTrigger value="campaigns" data-testid="tab-campaigns"><Megaphone className="h-4 w-4 mr-2" /> Campaigns</TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="mt-4 space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton endpoint="/api/comm-lists/export" filename="comm_lists_export.csv" testId="button-export-comm-lists" />
            <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-list">
                  <Plus className="mr-2 h-4 w-4" /> New List
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Create Communication List</DialogTitle></DialogHeader>
                <CreateListForm onSubmit={(d) => createListMutation.mutate(d)} isPending={createListMutation.isPending} />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listsData?.map(list => (
              <Card key={list.id} className="border-border/50" data-testid={`card-list-${list.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{list.name}</CardTitle>
                    <Badge variant="outline" className="text-xs">{list.source}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-2">{list.description || "No description"}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{list.memberCount || 0} members</span>
                    {list.externalId && <span className="font-mono">{list.externalId}</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!listsData || listsData.length === 0) && (
              <div className="col-span-full p-8 text-center text-muted-foreground">No communication lists yet</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="flex justify-end gap-2">
            <ExportButton endpoint="/api/campaigns/export" filename="campaigns_export.csv" testId="button-export-campaigns" />
            <Dialog open={createCampaignOpen} onOpenChange={setCreateCampaignOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground" data-testid="button-create-campaign">
                  <Plus className="mr-2 h-4 w-4" /> New Campaign
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Create Campaign Draft</DialogTitle></DialogHeader>
                <CreateCampaignForm onSubmit={(d) => createCampaignMutation.mutate(d)} isPending={createCampaignMutation.isPending} />
              </DialogContent>
            </Dialog>
          </div>

          <Card className="border-border/50">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[400px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-3 sm:p-4 text-sm font-medium text-muted-foreground">Subject</th>
                    <th className="text-left p-3 sm:p-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 sm:p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Created</th>
                    <th className="text-right p-3 sm:p-4 text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignsData?.map(campaign => (
                    <tr key={campaign.id} className="border-b border-border/30" data-testid={`row-campaign-${campaign.id}`}>
                      <td className="p-3 sm:p-4">
                        <p className="font-medium truncate max-w-[180px] sm:max-w-none">{campaign.subject}</p>
                        {campaign.externalCampaignId && <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-[160px]">{campaign.externalCampaignId}</p>}
                      </td>
                      <td className="p-3 sm:p-4">
                        <Badge variant="outline" className={campaignStatusColors[campaign.status] || ""}>{campaign.status}</Badge>
                      </td>
                      <td className="p-3 sm:p-4 text-sm text-muted-foreground hidden sm:table-cell">{new Date(campaign.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 sm:p-4 text-right">
                        {campaign.status === "draft" && (
                          <Button variant="ghost" size="sm" onClick={() => updateCampaignMutation.mutate({ id: campaign.id, status: "sent", sentAt: new Date().toISOString() })} data-testid={`button-mark-sent-${campaign.id}`}>
                            <Send className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Mark</span> Sent
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!campaignsData || campaignsData.length === 0) && (
                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No campaigns yet</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateListForm({ onSubmit, isPending }: { onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ name: "", source: "manual", description: "", externalId: "", memberCount: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, memberCount: form.memberCount ? Number(form.memberCount) : 0 }); }} className="space-y-4">
      <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required data-testid="input-list-name" /></div>
      <div>
        <Label>Source</Label>
        <Select value={form.source} onValueChange={(v) => setForm(f => ({ ...f, source: v }))}>
          <SelectTrigger data-testid="select-list-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="klaviyo">Klaviyo</SelectItem>
            <SelectItem value="hubspot">HubSpot</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>External ID</Label><Input value={form.externalId} onChange={(e) => setForm(f => ({ ...f, externalId: e.target.value }))} placeholder="Klaviyo list ID" data-testid="input-external-id" /></div>
      <div><Label>Member Count</Label><Input type="number" value={form.memberCount} onChange={(e) => setForm(f => ({ ...f, memberCount: e.target.value }))} data-testid="input-member-count" /></div>
      <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={2} data-testid="input-list-description" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-list">{isPending ? "Creating..." : "Create List"}</Button>
    </form>
  );
}

function CreateCampaignForm({ onSubmit, isPending }: { onSubmit: (d: Record<string, unknown>) => void; isPending: boolean }) {
  const [form, setForm] = useState({ subject: "", bodyText: "", externalCampaignId: "", externalCampaignLink: "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div><Label>Subject *</Label><Input value={form.subject} onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))} required data-testid="input-campaign-subject" /></div>
      <div><Label>Body</Label><Textarea value={form.bodyText} onChange={(e) => setForm(f => ({ ...f, bodyText: e.target.value }))} rows={6} placeholder="Campaign content..." data-testid="input-campaign-body" /></div>
      <div><Label>External Campaign ID</Label><Input value={form.externalCampaignId} onChange={(e) => setForm(f => ({ ...f, externalCampaignId: e.target.value }))} placeholder="Klaviyo campaign ID" data-testid="input-campaign-ext-id" /></div>
      <div><Label>External Campaign Link</Label><Input value={form.externalCampaignLink} onChange={(e) => setForm(f => ({ ...f, externalCampaignLink: e.target.value }))} placeholder="https://..." data-testid="input-campaign-ext-link" /></div>
      <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={isPending} data-testid="button-submit-campaign">{isPending ? "Creating..." : "Create Campaign Draft"}</Button>
    </form>
  );
}
