import { RefreshCcw, Plus, DollarSign, Calendar, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const ROUND_STAGES = [
  { label: "Pre-Seed", color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  { label: "Seed", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  { label: "Bridge", color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  { label: "Series A", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  { label: "Strategic", color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20" },
  { label: "Closed", color: "text-muted-foreground bg-muted/40 border-border" },
];

export default function CapitalRoundsPage() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCcw className="w-5 h-5 text-primary" />
            Funding Rounds
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track each funding round — target size, close date, participating investors, and status.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" data-testid="btn-add-round">
          <Plus className="w-3.5 h-3.5" />
          Add Round
        </Button>
      </div>

      <div className="flex gap-3 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        {ROUND_STAGES.map(s => (
          <Badge
            key={s.label}
            variant="outline"
            className={`cursor-pointer text-xs whitespace-nowrap ${s.color}`}
            data-testid={`filter-round-stage-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {s.label}
          </Badge>
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center p-12">
        <Card className="max-w-md w-full border-dashed border-border/60 bg-muted/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <RefreshCcw className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-base mb-1">No funding rounds yet</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create a round to track its target raise amount, timeline, participating investors, and close status. All commitments and pipeline activity can be linked to a specific round.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full mt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <DollarSign className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Set target raise size, minimum, and maximum check size</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Users className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Link investor targets and track participation per round</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Set open date, target close date, and actual close date</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <ChevronRight className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Move commitments to wired/closed when the round closes</span>
              </div>
            </div>
            <Button size="sm" className="mt-2 gap-1.5" data-testid="btn-add-first-round">
              <Plus className="w-3.5 h-3.5" />
              Create First Round
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
