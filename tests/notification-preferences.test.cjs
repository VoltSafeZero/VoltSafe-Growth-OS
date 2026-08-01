"use strict";
// Phase 10A — Notification Preferences / Muting
// Source-grep test suite: verifies schema, backend routes, notification behavior,
// and frontend controls/visual state.
// Run: node tests/notification-preferences.test.cjs

const fs = require("fs");

const ROUTES = "server/routes.ts";
const FRONTEND = "client/src/pages/current.tsx";

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
    failures.push(label);
  }
}

function assertIn(label, file, pattern, detail = "") {
  const content = fs.readFileSync(file, "utf8");
  const match = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  assert(label, match, detail || `pattern not found in ${file}`);
}

function assertNotIn(label, file, pattern, detail = "") {
  const content = fs.readFileSync(file, "utf8");
  const match = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  assert(label, !match, detail || `unexpected pattern found in ${file}`);
}

console.log("=== Phase 10A — Notification Preferences / Muting ===\n");

// ── Section 1: Schema / DDL ────────────────────────────────────────────────────
console.log("── Schema / DDL ──");

assertIn(
  "DB1. CREATE TABLE current_channel_preferences (idempotent)",
  ROUTES,
  "CREATE TABLE IF NOT EXISTS current_channel_preferences"
);

assertIn(
  "DB2. current_channel_preferences has channel_id FK",
  ROUTES,
  /current_channel_preferences \([\s\S]{1,500}channel_id INTEGER NOT NULL REFERENCES current_channels/
);

assertIn(
  "DB3. current_channel_preferences has user_id FK",
  ROUTES,
  /current_channel_preferences \([\s\S]{1,500}user_id INTEGER NOT NULL REFERENCES users/
);

assertIn(
  "DB4. notification_level CHECK constraint has all three values",
  ROUTES,
  "CHECK (notification_level IN ('all', 'mentions', 'muted'))"
);

assertIn(
  "DB5. UNIQUE constraint on (channel_id, user_id)",
  ROUTES,
  /UNIQUE \(channel_id, user_id\)/
);

assertIn(
  "DB6. current_conversation_members.is_muted already exists and is selected in DM list",
  ROUTES,
  "me.is_muted,"
);

// ── Section 2: GET /api/current/channels includes notificationLevel ─────────────
console.log("\n── GET /api/current/channels — notificationLevel ──");

assertIn(
  "CL1. Channel list SELECT includes current_channel_preferences subquery",
  ROUTES,
  "FROM current_channel_preferences ccp"
);

assertIn(
  "CL2. Channel list subquery uses correct user scoping",
  ROUTES,
  /WHERE ccp.channel_id = c.id AND ccp.user_id = \$\{userId\}/
);

assertIn(
  "CL3. Channel list COALESCE defaults to 'mentions'",
  ROUTES,
  /COALESCE\(\s*\(SELECT ccp\.notification_level[\s\S]{1,200}'mentions'\s*\) AS notification_level/
);

assertIn(
  "CL4. Channel list response maps notificationLevel",
  ROUTES,
  "notificationLevel: r.notification_level || 'mentions',"
);

// ── Section 3: GET /api/current/channel-preferences ───────────────────────────
console.log("\n── GET /api/current/channel-preferences ──");

assertIn(
  "CP1. Route exists",
  ROUTES,
  'app.get("/api/current/channel-preferences"'
);

assertIn(
  "CP2. Route requires auth",
  ROUTES,
  /app\.get\("\/api\/current\/channel-preferences", requireAuth/
);

assertIn(
  "CP3. Route queries current_channel_preferences table",
  ROUTES,
  /SELECT channel_id, notification_level\s*FROM current_channel_preferences\s*WHERE user_id/
);

assertIn(
  "CP4. Route returns channelId + notificationLevel",
  ROUTES,
  "channelId: Number(r.channel_id),"
);

// ── Section 4: PUT /api/current/channels/:id/preference ───────────────────────
console.log("\n── PUT /api/current/channels/:id/preference ──");

assertIn(
  "PP1. Route exists",
  ROUTES,
  'app.put("/api/current/channels/:id/preference"'
);

assertIn(
  "PP2. Route requires auth",
  ROUTES,
  /app\.put\("\/api\/current\/channels\/:id\/preference", requireAuth/
);

assertIn(
  "PP3. Invalid level rejected",
  ROUTES,
  'Invalid notificationLevel. Must be all, mentions, or muted'
);

assertIn(
  "PP4. Level allowlist check uses array includes",
  ROUTES,
  '["all", "mentions", "muted"].includes(level)'
);

assertIn(
  "PP5. Channel existence check before upsert",
  ROUTES,
  "SELECT id, is_private FROM current_channels WHERE id = ${channelId} LIMIT 1"
);

assertIn(
  "PP6. Upsert uses ON CONFLICT DO UPDATE",
  ROUTES,
  "ON CONFLICT (channel_id, user_id) DO UPDATE SET"
);

assertIn(
  "PP7. Upsert updates notification_level and updated_at",
  ROUTES,
  /notification_level = EXCLUDED.notification_level,\s*updated_at = NOW\(\)/
);

assertIn(
  "PP8. Response returns channelId and notificationLevel",
  ROUTES,
  "res.json({ channelId, notificationLevel: level });"
);

assertIn(
  "PP9. User can only set own preference (uses session userId, not request param)",
  ROUTES,
  "VALUES (${channelId}, ${userId}, '${level}', NOW(), NOW())"
);

// ── Section 5: PUT /api/current/dms/:id/preference ────────────────────────────
console.log("\n── PUT /api/current/dms/:id/preference ──");

assertIn(
  "DP1. Route exists",
  ROUTES,
  'app.put("/api/current/dms/:id/preference"'
);

assertIn(
  "DP2. Route requires auth",
  ROUTES,
  /app\.put\("\/api\/current\/dms\/:id\/preference", requireAuth/
);

assertIn(
  "DP3. Membership check before update",
  ROUTES,
  "Not a member of this conversation"
);

assertIn(
  "DP4. Accepts notificationLevel: 'all'|'muted'",
  ROUTES,
  '["all", "muted"].includes(level)'
);

assertIn(
  "DP5. Accepts isMuted boolean",
  ROUTES,
  'typeof req.body?.isMuted === "boolean"'
);

assertIn(
  "DP6. Updates current_conversation_members.is_muted",
  ROUTES,
  /UPDATE current_conversation_members\s*SET is_muted = \$\{isMuted\}/
);

assertIn(
  "DP7. User can only update own member row (WHERE user_id = userId)",
  ROUTES,
  /SET is_muted = \$\{isMuted\}\s*WHERE conversation_id = \$\{convId\} AND user_id = \$\{userId\}/
);

assertIn(
  "DP8. Response returns isMuted and notificationLevel",
  ROUTES,
  "{ conversationId: convId, isMuted, notificationLevel: isMuted ? \"muted\" : \"all\" }"
);

// ── Section 6: DM notification respects is_muted ──────────────────────────────
console.log("\n── DM notification respects is_muted ──");

assertIn(
  "DN1. DM send checks is_muted before inserting notification",
  ROUTES,
  "Respect DM mute preference — skip notification if recipient muted this DM"
);

assertIn(
  "DN2. Mute check uses correct query",
  ROUTES,
  /SELECT is_muted FROM current_conversation_members WHERE conversation_id = \$\{convId\} AND user_id = \$\{recipientId\}/
);

assertIn(
  "DN3. Muted recipients are skipped (continue)",
  ROUTES,
  "(muteCheck.rows[0] as any)?.is_muted) continue;"
);

assertIn(
  "DN4. Sender is still excluded from DM notifications (user_id != userId)",
  ROUTES,
  `SELECT user_id FROM current_conversation_members WHERE conversation_id = \${convId} AND user_id != \${userId}`
);

// ── Section 7: Channel notification respects preferences ─────────────────────
console.log("\n── Channel notification respects preferences ──");

assertIn(
  "CN1. syncCurrentMentions checks channel mute preference",
  ROUTES,
  // Phase 2 rewrite: mute check uses resolvedChannelId (pre-resolved once per call)
  // and only applies to @all-expanded users; direct @user always notifies.
  "if (!isDirectMention && resolvedChannelId !== null)"
);

assertIn(
  "CN2. Muted channel preference check queries current_channel_preferences",
  ROUTES,
  // Phase 2: uses resolvedChannelId (pre-fetched before the user loop)
  /SELECT notification_level FROM current_channel_preferences WHERE channel_id = \$\{resolvedChannelId\} AND user_id = \$\{mid\}/
);

assertIn(
  "CN3. Muted users are skipped in syncCurrentMentions",
  ROUTES,
  "if (level === 'muted') continue;"
);

assertIn(
  "CN4. Channel pref check is scoped to channelSlug (not applied to record currents)",
  ROUTES,
  "if (channelSlug) {"
);

assertIn(
  "CN5. 'all' mode: channel post triggers all-messages notifications",
  ROUTES,
  "notify users who have opted into all-messages for this channel"
);

assertIn(
  "CN6. 'all' mode queries users with all preference for this channel",
  ROUTES,
  `ccp.notification_level = 'all' AND ccp.user_id != \${userId}`
);

assertIn(
  "CN7. 'all' mode notification type is current_message",
  ROUTES,
  "'current_message'"
);

assertIn(
  "CN8. Sender never receives their own all-messages notification",
  ROUTES,
  /notification_level = 'all' AND (?:ccp\.)?user_id != \$\{userId\}/
);

// ── Section 8: Frontend — imports ─────────────────────────────────────────────
console.log("\n── Frontend: imports ──");

assertIn("FI1. Bell imported from lucide-react", FRONTEND, "Bell,");
assertIn("FI2. BellOff imported from lucide-react", FRONTEND, "BellOff,");
assertIn("FI3. BellRing imported from lucide-react", FRONTEND, "BellRing,");

// ── Section 9: Frontend — Channel interface ────────────────────────────────────
console.log("\n── Frontend: Channel interface ──");

assertIn(
  "CI1. Channel interface has notificationLevel field",
  FRONTEND,
  "notificationLevel?: 'all' | 'mentions' | 'muted';"
);

// ── Section 10: Frontend — Mutations ──────────────────────────────────────────
console.log("\n── Frontend: Mutations ──");

assertIn(
  "FM1. channelPrefMutation declared",
  FRONTEND,
  "const channelPrefMutation = useMutation({"
);

assertIn(
  "FM2. channelPrefMutation calls PUT /api/current/channels/:id/preference",
  FRONTEND,
  'apiRequest("PUT", `/api/current/channels/${channelId}/preference`'
);

assertIn(
  "FM3. channelPrefMutation invalidates channel list",
  FRONTEND,
  /channelPrefMutation[\s\S]{1,500}invalidateQueries.*\/api\/current\/channels/
);

assertIn(
  "FM4. channelPrefMutation shows toast: Channel muted",
  FRONTEND,
  "Channel muted"
);

assertIn(
  "FM5. channelPrefMutation shows toast: Channel set to mentions only",
  FRONTEND,
  "Channel set to mentions only"
);

assertIn(
  "FM6. channelPrefMutation shows toast: Channel set to all messages",
  FRONTEND,
  "Channel set to all messages"
);

assertIn(
  "FM7. dmPrefMutation declared",
  FRONTEND,
  "const dmPrefMutation = useMutation({"
);

assertIn(
  "FM8. dmPrefMutation calls PUT /api/current/dms/:id/preference",
  FRONTEND,
  'apiRequest("PUT", `/api/current/dms/${conversationId}/preference`'
);

assertIn(
  "FM9. dmPrefMutation invalidates DM list",
  FRONTEND,
  /dmPrefMutation[\s\S]{1,500}invalidateQueries.*\/api\/current\/dms/
);

assertIn(
  "FM10. dmPrefMutation shows toast: Conversation muted",
  FRONTEND,
  "Conversation muted"
);

assertIn(
  "FM11. dmPrefMutation shows toast: Conversation unmuted",
  FRONTEND,
  "Conversation unmuted"
);

// ── Section 11: Frontend — Channel sidebar controls ────────────────────────────
console.log("\n── Frontend: Channel sidebar controls ──");

assertIn(
  "CS1. Channel row computes isMutedChan",
  FRONTEND,
  "const isMutedChan = channel.notificationLevel === 'muted';"
);

assertIn(
  "CS2. Channel pref dropdown button has data-testid",
  FRONTEND,
  "data-testid={`btn-channel-pref-${channel.slug}`}"
);

assertIn(
  "CS3. 'All messages' menu item has data-testid",
  FRONTEND,
  "data-testid={`pref-all-${channel.slug}`}"
);

assertIn(
  "CS4. 'Mentions only' menu item has data-testid",
  FRONTEND,
  "data-testid={`pref-mentions-${channel.slug}`}"
);

assertIn(
  "CS5. 'Mute channel' menu item has data-testid",
  FRONTEND,
  "data-testid={`pref-muted-${channel.slug}`}"
);

assertIn(
  "CS6. Muted channel icon shown inline in channel row",
  FRONTEND,
  "data-testid={`channel-muted-icon-${channel.slug}`}"
);

assertIn(
  "CS7. Channel muted applies visual dimming (text-muted-foreground/40)",
  FRONTEND,
  "text-muted-foreground/40 hover:bg-muted/40 hover:text-muted-foreground/70"
);

assertIn(
  "CS8. Muted unread badge is subdued (bg-muted/60)",
  FRONTEND,
  "bg-muted/60 text-muted-foreground/50"
);

assertIn(
  "CS9. All three pref levels trigger channelPrefMutation.mutate",
  FRONTEND,
  /channelPrefMutation\.mutate\(\{ channelId: channel\.id, notificationLevel: 'all' \}\)/
);

assertIn(
  "CS10. Mentions option triggers channelPrefMutation.mutate",
  FRONTEND,
  /channelPrefMutation\.mutate\(\{ channelId: channel\.id, notificationLevel: 'mentions' \}\)/
);

assertIn(
  "CS11. Mute option triggers channelPrefMutation.mutate",
  FRONTEND,
  /channelPrefMutation\.mutate\(\{ channelId: channel\.id, notificationLevel: 'muted' \}\)/
);

assertIn(
  "CS12. BellOff shown in dropdown trigger when channel is muted",
  FRONTEND,
  /isMutedChan[\s\S]{1,200}BellOff/
);

// ── Section 12: Frontend — DM sidebar controls ────────────────────────────────
console.log("\n── Frontend: DM sidebar controls ──");

assertIn(
  "DS1. DM row computes isMutedDm",
  FRONTEND,
  "const isMutedDm = dm.isMuted;"
);

assertIn(
  "DS2. DM pref button has data-testid",
  FRONTEND,
  "data-testid={`btn-dm-pref-${dm.conversationId}`}"
);

assertIn(
  "DS3. 'Notify me' menu item has data-testid",
  FRONTEND,
  "data-testid={`dm-pref-notify-${dm.conversationId}`}"
);

assertIn(
  "DS4. 'Mute conversation' menu item has data-testid",
  FRONTEND,
  "data-testid={`dm-pref-mute-${dm.conversationId}`}"
);

assertIn(
  "DS5. Muted DM shows BellOff icon inline",
  FRONTEND,
  "data-testid={`dm-muted-icon-${dm.conversationId}`}"
);

assertIn(
  "DS6. Muted DM applies visual dimming (text-muted-foreground/40)",
  FRONTEND,
  /isMutedDm[\s\S]{1,400}text-muted-foreground\/40/
);

assertIn(
  "DS7. Muted DM avatar is dimmed (opacity-40)",
  FRONTEND,
  "isMutedDm && !active && \"opacity-40\""
);

assertIn(
  "DS8. Muted DM content area is dimmed (opacity-50)",
  FRONTEND,
  "isMutedDm && !active && \"opacity-50\""
);

assertIn(
  "DS9. 'Notify me' triggers dmPrefMutation with isMuted: false",
  FRONTEND,
  "dmPrefMutation.mutate({ conversationId: dm.conversationId, isMuted: false })"
);

assertIn(
  "DS10. 'Mute' triggers dmPrefMutation with isMuted: true",
  FRONTEND,
  "dmPrefMutation.mutate({ conversationId: dm.conversationId, isMuted: true })"
);

// ── Section 13: Security ──────────────────────────────────────────────────────
console.log("\n── Security ──");

assertIn(
  "SEC1. Channel pref route uses session userId (not req.params)",
  ROUTES,
  /PUT.*channels.*preference[\s\S]{1,500}const userId = getSessionUserId\(req\)/
);

assertIn(
  "SEC2. DM pref route verifies membership before updating",
  ROUTES,
  /put\("\/api\/current\/dms\/:id\/preference"[\s\S]{1,500}Not a member of this conversation/
);

assertIn(
  "SEC3. Invalid DM pref level rejected",
  ROUTES,
  "Invalid notificationLevel for DM. Must be all or muted"
);

assertIn(
  "SEC4. Channel pref route validates channel exists",
  ROUTES,
  "Channel not found"
);

assertIn(
  "SEC5. DM mute update uses AND user_id = userId (own row only)",
  ROUTES,
  "WHERE conversation_id = ${convId} AND user_id = ${userId}"
);

// ── Section 14: Backward compatibility ────────────────────────────────────────
console.log("\n── Backward compatibility ──");

assertIn(
  "BC1. DM list still returns isMuted field",
  ROUTES,
  "isMuted: Boolean(r.is_muted),"
);

assertIn(
  "BC2. Channel list unreadCount still present",
  ROUTES,
  "unreadCount: Number(r.unread_count),"
);

assertIn(
  "BC3. syncCurrentMentions still fires for non-muted users",
  ROUTES,
  "syncCurrentMentions(Number(msg.id), userId, body, String(slug), null).catch(() => {});"
);

assertIn(
  "BC4. DM send route still posts messages normally",
  ROUTES,
  'app.post("/api/current/dms/:id/messages"'
);

assertIn(
  "BC5. Channel post route still works for archived checks (Phase 9B guards intact)",
  ROUTES,
  "Cannot edit messages in an archived channel"
);

assertIn(
  "BC6. Existing 9A/9B/9C channel tests are unaffected (Phase 9B routes still present)",
  ROUTES,
  "Cannot react to messages in an archived channel"
);

assertIn(
  "BC7. DmConversation interface isMuted field present",
  FRONTEND,
  "isMuted: boolean;"
);

// ── Section 15: No write leakage ─────────────────────────────────────────────
console.log("\n── No write leakage ──");

assertNotIn(
  "NW1. Channel pref route does not use body userId in INSERT (session-scoped only)",
  ROUTES,
  /INSERT INTO current_channel_preferences[\s\S]{1,300}req\.body/
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failures.length > 0) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
