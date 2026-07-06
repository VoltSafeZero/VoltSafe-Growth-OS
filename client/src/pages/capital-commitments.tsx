import { CheckSquare, Plus, DollarSign, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const COMMITMENT_STATUSES = [
  { label: "Soft Commit", color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  { label: "Committed", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  { label: "Docs Sent", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  { label: "Wired / Closed", color: "text-primary bg-primary/10 border-primary/20" },
  { label: "Fallen Through", color: "text-destructive bg-destructive/10 border-destructive/20" },
];

export default function CapitalCommitmentsPage() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-primary" />
            Commitments
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Firm and soft commitments from investors — from verbal commit through to wired funds.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" data-testid="btn-add-commitment">
          <Plus className="w-3.5 h-3.5" />
          Log Commitment
        </Button>
      </div>

      <div className="flex gap-3 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        {COMMITMENT_STATUSES.map(s => (
          <Badge
            key={s.label}
            variant="outline"
            className={`cursor-pointer text-xs whitespace-nowrap ${s.color}`}
            data-testid={`filter-commitment-${s.label.toLowerCase().replace(/[\s/]+/g, "-")}`}
          >
            {s.label}
          </Badge>
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center p-12">
        <Card className="max-w-md w-full border-dashed border-border/60 bg-muted/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckSquare className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-base mb-1">No commitments logged</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Log soft commits and firm commitments as they come in. Track commitment amount, investor, associated round, expected wire date, and status through to close.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full mt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <DollarSign className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Record commitment amount and link to investor target and round</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Clock className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Track expected wire date and follow up on overdue commitments</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <AlertCircle className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Distinguish soft commits from firm commitments and wired funds</span>
              </div>
            </div>
            <Button size="sm" className="mt-2 gap-1.5" data-testid="btn-add-first-commitment">
              <Plus className="w-3.5 h-3.5" />
              Log First Commitment
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
