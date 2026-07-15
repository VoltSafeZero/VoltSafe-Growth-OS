/**
 * mentions.tsx — Full-page My Mentions feed
 *
 * Accessible at /mentions — shows all global @mentions received by the current user.
 */

import { AtSign, Bell } from "lucide-react";
import { MyMentionsFeed } from "@/components/mentions/my-mentions-feed";

export default function MentionsPage() {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" data-testid="mentions-page">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <AtSign className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">My Mentions</h1>
          <p className="text-sm text-muted-foreground">
            Every place across VoltSafe where you've been @mentioned
          </p>
        </div>
      </div>

      <MyMentionsFeed showFilters maxItems={undefined} />
    </div>
  );
}
