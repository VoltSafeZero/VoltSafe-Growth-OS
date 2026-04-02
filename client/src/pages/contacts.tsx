import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Mail, Phone, Search, UserCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Contact, Account } from "@shared/schema";

type ContactWithAccount = Contact & { accountName?: string };

export default function ContactsPage() {
  const [search, setSearch] = useState("");

  const { data: contacts = [], isLoading: loadingContacts } = useQuery<ContactWithAccount[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const enriched: ContactWithAccount[] = contacts.map((c) => ({
    ...c,
    accountName: accountMap[c.accountId] ?? "—",
  }));

  const filtered = enriched.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q) ||
      c.accountName?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              All contacts across your accounts
            </p>
          </div>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/30 border-transparent focus-visible:border-primary/50 rounded-lg"
              data-testid="input-search-contacts"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {loadingContacts ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCircle2 className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No contacts found</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {search ? "Try a different search term" : "Add contacts from within an account"}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-4 px-4 py-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 border border-border/30 hover:border-border/60 transition-all group"
                data-testid={`contact-row-${contact.id}`}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">
                    {(contact.firstName?.[0] || contact.name?.[0] || "?").toUpperCase()}
                    {(contact.lastName?.[0] || "").toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate" data-testid={`contact-name-${contact.id}`}>
                      {contact.name}
                    </span>
                    {contact.isPrimary && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">
                        Primary
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {contact.title && (
                      <span className="text-xs text-muted-foreground truncate">{contact.title}</span>
                    )}
                    {contact.title && contact.accountName && (
                      <span className="text-muted-foreground/40 text-xs">·</span>
                    )}
                    {contact.accountName && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        {contact.accountName}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      data-testid={`contact-email-${contact.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span className="hidden lg:inline">{contact.email}</span>
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      data-testid={`contact-phone-${contact.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span className="hidden lg:inline">{contact.phone}</span>
                    </a>
                  )}
                  {contact.relationshipStrength && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${
                        contact.relationshipStrength === "strong"
                          ? "border-green-500/40 text-green-400"
                          : contact.relationshipStrength === "weak"
                          ? "border-red-500/40 text-red-400"
                          : "border-border/50 text-muted-foreground"
                      }`}
                    >
                      {contact.relationshipStrength}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
