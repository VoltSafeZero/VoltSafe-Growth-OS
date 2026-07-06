import { UserCircle, Users, Mail, Phone, Building2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const CONTACT_TYPES = [
  "VC Partner", "Angel Investor", "Family Office Principal",
  "Government Program Officer", "Connector / Referrer", "Fund Analyst",
];

export default function CapitalContactsPage() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-primary" />
            Investor Contacts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Individual contacts at investor organizations — partners, analysts, program officers, and connectors.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" data-testid="btn-add-contact">
          <Plus className="w-3.5 h-3.5" />
          Add Contact
        </Button>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            className="pl-8 h-8 text-sm"
            data-testid="input-contact-search"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CONTACT_TYPES.map(t => (
            <Badge
              key={t}
              variant="outline"
              className="cursor-pointer text-xs hover:bg-primary/10 hover:border-primary/40"
              data-testid={`filter-contact-type-${t.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {t}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-12">
        <Card className="max-w-md w-full border-dashed border-border/60 bg-muted/20">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-base mb-1">No contacts yet</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Track individual people at investor organizations — VC partners, angel investors, family office principals, government program officers, and connectors who can make introductions.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full mt-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Mail className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Log last contact date and preferred communication method</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Building2 className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Link contacts to their investor organization in Investor Targets</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                <Phone className="w-4 h-4 shrink-0 text-primary/60" />
                <span>Track connectors and referrers separately from direct investors</span>
              </div>
            </div>
            <Button size="sm" className="mt-2 gap-1.5" data-testid="btn-add-first-contact">
              <Plus className="w-3.5 h-3.5" />
              Add First Contact
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
