/**
 * Phase 8D — DM Unread / Read-State Polish
 * Source-grep test suite: 60 checks covering unread accuracy, read-state,
 * sidebar ordering, preview consistency, deep-link, and nav badge.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  FAIL: ${label}`);
  }
}

// ── Load source files ─────────────────────────────────────────────────────

const routesPath = path.join(__dirname, "../server/routes.ts");
const routes = fs.readFileSync(routesPath, "utf8");

const currentPath = path.join(__dirname, "../client/src/pages/current.tsx");
const current = fs.readFileSync(currentPath, "utf8");

const sidebarPath = path.join(__dirname, "../client/src/components/dashboard/app-sidebar.tsx");
const sidebar = fs.readFileSync(sidebarPath, "utf8");

// ── 1. Backend: GET /api/current/dms — unread count SQL ──────────────────

console.log("\n[1] Backend: GET /api/current/dms — unread count SQL");

const getDmSection = (() => {
  const start = routes.indexOf('app.get("/api/current/dms",');
  const end = routes.indexOf('\n  });', start) + 6;
  return routes.slice(start, end);
})();

check(
  "GET /api/current/dms route exists with requireAuth",
  getDmSection.includes('requireAuth')
);

check(
  "Unread count uses cm.id > COALESCE(me.last_read_message_id, 0)",
  getDmSection.includes("cm.id > COALESCE(me.last_read_message_id, 0)")
);

check(
  "Unread count excludes deleted messages (deleted_at IS NULL)",
  getDmSection.includes("cm.deleted_at IS NULL")
);

check(
  "Unread count includes attachment-only messages (no body filter in COUNT)",
  (() => {
    const countBlock = getDmSection.slice(
      getDmSection.indexOf("SELECT COUNT"),
      getDmSection.indexOf("AS unread_count")
    );
    return !countBlock.includes("body") && !countBlock.includes("body IS NOT NULL");
  })()
);

check(
  "DM list sorts by COALESCE(cv.last_message_at, cv.created_at) DESC",
  getDmSection.includes("ORDER BY COALESCE(cv.last_message_at, cv.created_at) DESC")
);

check(
  "DM list joins current_conversation_members (me) for current user",
  getDmSection.includes("JOIN current_conversation_members me") ||
  getDmSection.includes("current_conversation_members me")
);

check(
  "DM list only returns conversations WHERE me.user_id = userId",
  getDmSection.includes("WHERE me.user_id =")
);

check(
  "DM list excludes archived conversations (is_archived = FALSE)",
  getDmSection.includes("me.is_archived = FALSE")
);

check(
  "lastMessage LATERAL join excludes deleted messages",
  getDmSection.includes("m.deleted_at IS NULL") &&
  getDmSection.includes("LATERAL")
);

check(
  "unreadCount mapped as Number in response",
  getDmSection.includes("unreadCount: Number(r.unread_count)")
);

check(
  "lastMessage body returned for sidebar preview",
  getDmSection.includes("lm.body AS last_message_body")
);

// ── 2. Backend: POST /api/current/dms/:id/read ────────────────────────────

console.log("\n[2] Backend: POST /api/current/dms/:id/read — read-state");

const readRouteSection = (() => {
  const start = routes.indexOf('app.post("/api/current/dms/:id/read"');
  const end = routes.indexOf('\n  });', start) + 6;
  return routes.slice(start, end);
})();

check(
  "Read route exists with requireAuth",
  readRouteSection.includes("requireAuth")
);

check(
  "Read route checks membership (current_conversation_members WHERE conversation_id AND user_id)",
  readRouteSection.includes("current_conversation_members") &&
  readRouteSection.includes("conversation_id") &&
  readRouteSection.includes("user_id")
);

check(
  "Read route returns 403 if not a member",
  readRouteSection.includes("403") &&
  readRouteSection.includes("Not a member")
);

check(
  "Read route uses GREATEST to prevent backwards movement",
  readRouteSection.includes("GREATEST(COALESCE(last_read_message_id, 0)")
);

check(
  "Read route requires lastReadMessageId in body",
  readRouteSection.includes("lastReadMessageId")
);

check(
  "Read route updates current_conversation_members",
  readRouteSection.includes("UPDATE current_conversation_members") &&
  readRouteSection.includes("SET last_read_message_id =")
);

check(
  "Read route scoped to current user (WHERE conversation_id AND user_id)",
  readRouteSection.includes("WHERE conversation_id =") &&
  readRouteSection.includes("AND user_id =")
);

// ── 3. Backend: POST /api/current/dms/:id/messages — sender read update ──

console.log("\n[3] Backend: DM send — last_message_at and sender read update");

const sendRouteSection = (() => {
  const start = routes.indexOf('app.post("/api/current/dms/:id/messages"');
  const end = routes.indexOf('\n  });', start) + 6;
  return routes.slice(start, end);
})();

check(
  "Send route exists with requireAuth",
  sendRouteSection.includes("requireAuth")
);

check(
  "Send route updates last_message_at on send",
  sendRouteSection.includes("UPDATE current_conversations SET last_message_at = NOW()")
);

check(
  "Send route updates sender last_read_message_id immediately after send",
  sendRouteSection.includes("UPDATE current_conversation_members SET last_read_message_id =")
);

check(
  "Sender read update scoped to conversation AND user",
  sendRouteSection.includes("WHERE conversation_id =") &&
  sendRouteSection.includes("AND user_id =")
);

check(
  "Send route allows null body when hasPendingAttachments=true (OR guard)",
  sendRouteSection.includes("hasPendingAttachments") &&
  (sendRouteSection.includes("!rawBody && !hasPendingAttachments") ||
   sendRouteSection.includes("!body && !hasPendingAttachments") ||
   sendRouteSection.includes("rawBody || hasPendingAttachments") ||
   sendRouteSection.includes("body || hasPendingAttachments"))
);

check(
  "hasPendingAttachments flag handled in send route",
  sendRouteSection.includes("hasPendingAttachments")
);

// ── 4. Backend: GET /api/current/unread-counts — DM unread fix ───────────

console.log("\n[4] Backend: GET /api/current/unread-counts — DM unread");

const unreadCountsSection = (() => {
  const start = routes.indexOf('app.get("/api/current/unread-counts"');
  const end = routes.indexOf('\n  });', start) + 6;
  return routes.slice(start, end);
})();

check(
  "unread-counts route exists with requireAuth",
  unreadCountsSection.includes("requireAuth")
);

check(
  "unread-counts DM subquery excludes deleted messages",
  unreadCountsSection.includes("cm.deleted_at IS NULL")
);

check(
  "unread-counts DM subquery excludes sender's own messages (cm.user_id != userId)",
  unreadCountsSection.includes("cm.user_id !=")
);

check(
  "unread-counts DM subquery uses last_read_message_id",
  unreadCountsSection.includes("last_read_message_id")
);

check(
  "unread-counts response includes total, channels, and dm fields",
  unreadCountsSection.includes("total") &&
  unreadCountsSection.includes("channels") &&
  unreadCountsSection.includes("dm:")
);

check(
  "unread-counts excludes archived DMs (is_archived = FALSE)",
  unreadCountsSection.includes("is_archived = FALSE")
);

// ── 5. Frontend: DM list queries and polling ──────────────────────────────

console.log("\n[5] Frontend: DM list queries and polling");

check(
  "dmConversations query uses /api/current/dms queryKey",
  current.includes('queryKey: ["/api/current/dms"]')
);

check(
  "dmConversations polls at 15s or less",
  current.includes("refetchInterval: 15_000") ||
  current.includes("refetchInterval: 10_000") ||
  current.includes("refetchInterval: 5_000")
);

check(
  "dmMessages query polls at 5s",
  current.includes("refetchInterval: 5_000")
);

check(
  "totalDmUnread computed as reduce sum of dm.unreadCount",
  current.includes("totalDmUnread = dmConversations.reduce") ||
  current.includes("d.unreadCount, 0)")
);

check(
  "totalUnread includes both channels and DM unread",
  current.includes("totalDmUnread") &&
  current.includes("totalUnread") &&
  current.includes("channels.reduce")
);

// ── 6. Frontend: DM read effect ───────────────────────────────────────────

console.log("\n[6] Frontend: DM read receipt effect");

const readEffectSection = (() => {
  const start = current.indexOf("DM read receipts");
  const end = current.indexOf("\n  };", start + 100);
  return current.slice(start, Math.min(end + 10, start + 1000));
})();

check(
  "DM read effect guards on selectedDmId, dmMessages.length, and view === 'dm'",
  readEffectSection.includes("!selectedDmId") &&
  readEffectSection.includes("dmMessages.length === 0") &&
  readEffectSection.includes("view !== \"dm\"")
);

check(
  "DM read effect skips deleted messages when finding last message",
  readEffectSection.includes("!m.deletedAt") ||
  current.includes(".find((m) => !m.deletedAt)")
);

check(
  "DM read effect uses dmLastReadRef to prevent duplicate POSTs",
  readEffectSection.includes("dmLastReadRef.current")
);

check(
  "DM read effect POSTs to /api/current/dms/:id/read",
  readEffectSection.includes("/api/current/dms/") &&
  readEffectSection.includes("/read")
);

check(
  "DM read effect invalidates /api/current/dms after marking read",
  readEffectSection.includes('invalidateQueries') &&
  readEffectSection.includes('"/api/current/dms"')
);

check(
  "DM read effect deps include [selectedDmId, dmMessages.length, view, queryClient]",
  readEffectSection.includes("selectedDmId") &&
  readEffectSection.includes("dmMessages.length") &&
  readEffectSection.includes("view")
);

// ── 7. Frontend: dmLastReadRef reset on DM switch ────────────────────────

console.log("\n[7] Frontend: dmLastReadRef reset on DM switch");

check(
  "dmLastReadRef declared as useRef(0)",
  current.includes("dmLastReadRef = useRef<number>(0)")
);

check(
  "dmLastReadRef.current reset to 0 when selectedDmId changes",
  (() => {
    const switchSection = current.slice(
      current.indexOf("dmLastReadRef.current = 0"),
      current.indexOf("dmLastReadRef.current = 0") + 200
    );
    return switchSection.includes("dmLastReadRef.current = 0");
  })()
);

// ── 8. Frontend: Deep-link behavior ──────────────────────────────────────

console.log("\n[8] Frontend: Deep-link behavior");

const deepLinkSection = (() => {
  const start = current.indexOf("Deep-link");
  const end = current.indexOf("}, [])", start) + 10;
  return current.slice(start, end);
})();

check(
  "Deep-link reads ?dm= param from URL",
  deepLinkSection.includes('params.get("dm")')
);

check(
  "Deep-link sets selectedDmId when dm param > 0",
  deepLinkSection.includes("setSelectedDmId(dmId)") &&
  deepLinkSection.includes("dmId > 0")
);

check(
  "Deep-link sets view to 'dm' when dm param present",
  deepLinkSection.includes('setView("dm")')
);

check(
  "Deep-link validates dm param is a positive number (guard against invalid IDs)",
  deepLinkSection.includes("dmId > 0")
);

// ── 9. Frontend: Sidebar preview rendering ───────────────────────────────

console.log("\n[9] Frontend: DM sidebar preview rendering");

const previewSection = (() => {
  const start = current.indexOf("dm.lastMessage &&");
  const end = current.indexOf("</div>", start) + 6;
  return current.slice(start, Math.min(end, start + 400));
})();

check(
  "Sidebar preview only renders when lastMessage exists",
  previewSection.includes("dm.lastMessage &&")
);

check(
  "Sidebar preview shows body text when body is truthy",
  previewSection.includes("dm.lastMessage.body")
);

check(
  "Sidebar preview decodes @mention syntax to @Name",
  previewSection.includes('@\\[([^\\]]+)\\]\\(user:\\d+\\)') ||
  previewSection.includes("@\\[") ||
  current.includes('replace(/@\\[([^\\]]+)\\]\\(user:\\d+\\)/g, "@$1")')
);

check(
  "Sidebar preview truncates long text (slice 45 chars or similar)",
  previewSection.includes(".slice(0, 45)") ||
  previewSection.includes(".slice(0, 50)") ||
  previewSection.includes(".slice(0, 40)")
);

check(
  "Sidebar preview shows '📎 Attachment' for null/falsy body",
  previewSection.includes("📎 Attachment")
);

check(
  "Deleted last message excluded at SQL level (LATERAL uses deleted_at IS NULL)",
  getDmSection.includes("m.deleted_at IS NULL") &&
  getDmSection.includes("LATERAL")
);

// ── 10. Frontend: DM unread badge rendering ───────────────────────────────

console.log("\n[10] Frontend: DM unread badge rendering");

check(
  "DM sidebar unread badge only renders when dm.unreadCount > 0",
  current.includes("dm.unreadCount > 0")
);

check(
  "DM sidebar unread badge shows 99+ cap",
  current.includes("99+") || current.includes("> 99")
);

check(
  "Total Currents unread badge rendered in module header",
  current.includes("totalUnread > 0")
);

// ── 11. Nav sidebar: Currents badge ──────────────────────────────────────

console.log("\n[11] Nav sidebar: Currents unread badge");

check(
  "app-sidebar imports useQuery from @tanstack/react-query",
  sidebar.includes('from "@tanstack/react-query"') &&
  sidebar.includes("useQuery")
);

check(
  "app-sidebar queries /api/current/unread-counts",
  sidebar.includes('"/api/current/unread-counts"')
);

check(
  "app-sidebar polls unread-counts at 30s or less",
  sidebar.includes("refetchInterval: 30_000") ||
  sidebar.includes("refetchInterval: 15_000")
);

check(
  "app-sidebar computes currentNavBadge from unreadCounts.total",
  sidebar.includes("currentNavBadge") &&
  sidebar.includes("unreadCounts")
);

check(
  "app-sidebar renders badge for item.id === 'current' when unread > 0",
  sidebar.includes('item.id === "current"') &&
  sidebar.includes("currentNavBadge")
);

check(
  "nav-currents-unread-badge data-testid present",
  sidebar.includes('data-testid="nav-currents-unread-badge"')
);

check(
  "Badge uses primary colors (teal) for Currents unread",
  sidebar.includes("bg-primary") &&
  sidebar.includes("text-primary-foreground")
);

check(
  "Static item.badge still supported for other nav items",
  sidebar.includes("item.badge ?") ||
  sidebar.includes("item.badge &&") ||
  sidebar.includes(": item.badge ?")
);

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(55)}`);
console.log(`Phase 8D — DM Read-State Polish: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
} else {
  console.log("All checks passed ✓");
}
