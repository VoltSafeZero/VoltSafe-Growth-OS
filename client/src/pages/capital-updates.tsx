import { BellRing, Plus, Mail, FileText, Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const UPDATE_TYPES = [
  { label: "Monthly Update", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
  { label: "Quarterly Update", color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  { label: "Milestone", color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  { label: "Data Room Access", color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  { label: "Ad Hoc", color: "text-muted-foreground bg-muted/40 border-border" },
];

export default function CapitalUpdatesPage() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <BellRing className="w-5 h-5 text-primary" />
            Investor Updates
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send and log regular updates to investors — monthly reports, milestone announcements, and data room access invites.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" data-testid="btn-add-update">
          <Plus className="w-3.5 h-3.5" />
          Create Update
        </Button>
      </div>

      <div className="flex gap-3 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        {UPDATE_TYPES.map(u => (
          <Badge
            key={u.label}
            variant="outline"
            className={`cursor-pointer text-xs whitespace-nowrap ${u.color}`}
            data-testid={`filter-update-type-${u.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {u.label}
          </Badge>
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center p-12">
        <Card className="max-w-md w-full border-dashed border-border/60 bg-muted/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <BellRing className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-base mb-1">No investor updates yet</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Keep investors informed with regular updates. Log monthly and quarterly reports, milestone announcements, data room access invites, and any ad hoc communications sent to current or prospective investors.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full mt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Mail className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Compose updates and track who received each communication</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <FileText className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Attach board decks, financial summaries, and investor reports</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Schedule recurring monthly and quarterly update reminders</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Users className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Segment distribution — prospects vs current investors vs advisors</span>
              </div>
            </div>
            <Button size="sm" className="mt-2 gap-1.5" data-testid="btn-create-first-update">
              <Plus className="w-3.5 h-3.5" />
              Create First Update
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
