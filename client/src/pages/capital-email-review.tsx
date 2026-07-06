import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Mail, Check, X, EyeOff, Clock, AlertTriangle, Inbox, ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ReviewItem = {
  id: number;
  email_thread_id: string | null;
  email_message_id: string | null;
  email_db_id: number | null;
  subject: string | null;
  sender_email: string | null;
  participants: string | null;
  snippet: string | null;
  latest_message_at: string | null;
  guessed_investor_id: number | null;
  guessed_contact_id: number | null;
  investor_name: string | null;
  contact_name: string | null;
  match_reason: string | null;
  match_confidence: number | null;
  status: string;
  created_at: string;
};

type Investor = { id: number; name: string };

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function confidenceBadge(c: number | null): JSX.Element {
  const pct = c ?? 0;
  const cls =
    pct >= 80 ? "bg-emerald-500/15 text-emerald-400" :
    pct >= 50 ? "bg-amber-500/15 text-amber-400" :
    "bg-muted text-muted-foreground";
  return <span className={`text-xs px-1.5 py-0.5 rounded-full ${cls}`}>{pct}% confidence</span>;
}

export default function CapitalEmailReviewPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [approveModal, setApproveModal] = useState<ReviewItem | null>(null);
  const [selectedInvestorId, setSelectedInvestorId] = useState<string>("");

  const { data: items = [], isLoading } = useQuery<ReviewItem[]>({
    queryKey: ["/api/capital/email-review", statusFilter],
    queryFn: () => fetch(`/api/capital/email-review?status=${statusFilter}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: investors = [] } = useQuery<Investor[]>({
    queryKey: ["/api/capital/investors-list"],
    queryFn: () => fetch("/api/capital/investors?limit=200", { credentials: "include" })
      .then(r => r.json())
      .then((d: any) => Array.isArray(d) ? d : []),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, investorId }: { id: number; investorId: number }) =>
      apiRequest("POST", `/api/capital/email-review/${id}/approve`, { capital_investor_id: investorId }),
    onSuccess: () => {
      toast({ title: "Linked to investor" });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/email-review"] });
      setApproveModal(null);
      setSelectedInvestorId("");
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/capital/email-review/${id}/reject`),
    onSuccess: () => {
      toast({ title: "Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/email-review"] });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/capital/email-review/${id}/ignore`),
    onSuccess: () => {
      toast({ title: "Ignored" });
      queryClient.invalidateQueries({ queryKey: ["/api/capital/email-review"] });
    },
    onError: () => toast({ title: "Failed to ignore", variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Capital Email Review
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Low-confidence email matches — review before linking to investors.
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-review-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="text-center py-16 space-y-2" data-testid="email-review-empty">
          <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending" ? "No pending items — the queue is clear." : `No ${statusFilter} items.`}
          </p>
        </div>
      )}

      <div className="space-y-3" data-testid="email-review-list">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-border/50 bg-card p-4 space-y-3"
            data-testid={`review-item-${item.id}`}
          >
            {/* Top row */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.subject || "(no subject)"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  From: {item.sender_email || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {confidenceBadge(item.match_confidence)}
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {fmtDate(item.latest_message_at || item.created_at)}
                </span>
              </div>
            </div>

            {/* Snippet */}
            {item.snippet && (
              <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/30 rounded px-2 py-1.5">
                {item.snippet}
              </p>
            )}

            {/* Match info */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              {item.investor_name && (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Guessed investor: <strong className="text-foreground ml-0.5">{item.investor_name}</strong>
                </span>
              )}
              {item.match_reason && (
                <span className="bg-muted/40 px-1.5 py-0.5 rounded">{item.match_reason}</span>
              )}
              {item.email_thread_id && (
                <a
                  href={`/inbox?thread=${item.email_thread_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                  data-testid={`review-open-thread-${item.id}`}
                >
                  <ExternalLink className="w-3 h-3" /> Open in Mail
                </a>
              )}
            </div>

            {/* Actions (only for pending) */}
            {item.status === "pending" && (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => {
                    setApproveModal(item);
                    setSelectedInvestorId(item.guessed_investor_id ? String(item.guessed_investor_id) : "");
                  }}
                  data-testid={`btn-approve-${item.id}`}
                >
                  <Check className="w-3 h-3 mr-1" /> Approve & Link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-400 hover:text-red-400"
                  onClick={() => rejectMut.mutate(item.id)}
                  disabled={rejectMut.isPending}
                  data-testid={`btn-reject-${item.id}`}
                >
                  <X className="w-3 h-3 mr-1" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => ignoreMut.mutate(item.id)}
                  disabled={ignoreMut.isPending}
                  data-testid={`btn-ignore-${item.id}`}
                >
                  <EyeOff className="w-3 h-3 mr-1" /> Ignore
                </Button>
              </div>
            )}

            {/* Non-pending status badge */}
            {item.status !== "pending" && (
              <Badge variant="secondary" className="text-xs capitalize">{item.status}</Badge>
            )}
          </div>
        ))}
      </div>

      {/* Approve modal */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="approve-modal">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4 mx-4">
            <h2 className="font-semibold text-sm">Link to Investor</h2>
            <p className="text-xs text-muted-foreground">
              Select the Capital investor to link this email thread to.
            </p>
            <Select value={selectedInvestorId} onValueChange={setSelectedInvestorId}>
              <SelectTrigger className="text-xs" data-testid="select-approve-investor">
                <SelectValue placeholder="Select investor…" />
              </SelectTrigger>
              <SelectContent>
                {investors.map((inv) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>{inv.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setApproveModal(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!selectedInvestorId || approveMut.isPending}
                onClick={() => approveMut.mutate({ id: approveModal.id, investorId: Number(selectedInvestorId) })}
                data-testid="btn-confirm-approve"
              >
                {approveMut.isPending ? "Linking…" : "Confirm Link"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
