"use strict";

/**
 * CURRENTS Phase 3 — Search + Message History Polish
 * Source-grep tests: pin the key structures/invariants in routes.ts and current.tsx
 * without executing real DB queries or hitting the network.
 */

const fs = require("fs");
const path = require("path");

const ROUTES_PATH = path.join(__dirname, "../server/routes.ts");
const FRONTEND_PATH = path.join(__dirname, "../client/src/pages/current.tsx");

const routes = fs.readFileSync(ROUTES_PATH, "utf8");
const frontend = fs.readFileSync(FRONTEND_PATH, "utf8");

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ── Backend: Search endpoint ──────────────────────────────────────────────────

test("search route is registered as GET /api/current/search", () => {
  assert(routes.includes('app.get("/api/current/search", requireAuth'), "Route declaration missing");
});

test("search route is guarded by requireAuth", () => {
  const idx = routes.indexOf('app.get("/api/current/search", requireAuth');
  assert(idx !== -1, "Route with requireAuth not found");
});

test("search returns paginated shape {items, total, page, pageSize, totalPages}", () => {
  assert(routes.includes("items, total, page, pageSize, totalPages"), "Paginated response shape missing");
});

test("search accepts type param with whitelist", () => {
  assert(
    routes.includes('"all", "messages", "files", "channels", "people"'),
    "Type whitelist missing"
  );
  assert(routes.includes("SEARCH_TYPE_WHITELIST"), "SEARCH_TYPE_WHITELIST missing");
});

test("search accepts scope param with whitelist", () => {
  assert(routes.includes('"all", "current"'), "Scope values missing");
  assert(routes.includes("SEARCH_SCOPE_WHITELIST"), "SEARCH_SCOPE_WHITELIST missing");
});

test("search validates scope against whitelist (no user input in SQL scope clause)", () => {
  assert(routes.includes("SEARCH_SCOPE_WHITELIST.has(scopeParam)"), "Scope whitelist check missing");
});

test("search supports channel_slug scoping", () => {
  assert(routes.includes("channelSlugParam"), "channelSlugParam missing");
  assert(routes.includes("scopedChannelId"), "scopedChannelId resolution missing");
});

test("search supports conversation_id scoping for DMs", () => {
  assert(routes.includes("convIdParam"), "convIdParam missing");
  assert(routes.includes("scopedConvId"), "scopedConvId resolution missing");
});

test("DM search enforces membership check", () => {
  assert(
    routes.includes("current_conversation_members WHERE conversation_id = ${convIdParam}"),
    "DM membership check missing in search"
  );
});

test("private channel access uses resolveChannelAccess in search", () => {
  const searchBlock = routes.slice(routes.indexOf("GET /api/current/search"), routes.indexOf("Structured Items Routes"));
  assert(searchBlock.includes("resolveChannelAccess"), "resolveChannelAccess not used in search scope resolution");
});

test("search pagination uses page + page_size params", () => {
  assert(routes.includes("Number(req.query.page)"), "page param missing");
  assert(routes.includes("Number(req.query.page_size)"), "page_size param missing");
  assert(routes.includes("const offset"), "offset calculation missing");
});

test("search paginator is backward-compatible with old limit param", () => {
  assert(routes.includes("Number(req.query.limit)"), "Old limit param compat missing");
});

test("search filters deleted messages", () => {
  const searchBlock = routes.slice(
    routes.indexOf("GET /api/current/search"),
    routes.indexOf("Structured Items Routes")
  );
  assert(searchBlock.includes("m.deleted_at IS NULL"), "Deleted-message filter missing in search");
});

test("search resultType field present for messages", () => {
  assert(routes.includes('resultType: "message"'), "resultType: message missing");
});

test("search resultType field present for files", () => {
  assert(routes.includes('resultType: "file"'), "resultType: file missing");
});

test("search resultType field present for channels", () => {
  assert(routes.includes('resultType: "channel"'), "resultType: channel missing");
});

test("search resultType field present for people", () => {
  assert(routes.includes('resultType: "person"'), "resultType: person missing");
});

test("file search returns downloadUrl via /api/attachments/file/", () => {
  assert(routes.includes("downloadUrl: `/api/attachments/file/${r.file_name}`"), "downloadUrl missing in file results");
});

test("channel search only returns non-archived channels", () => {
  const searchBlock = routes.slice(routes.indexOf("GET /api/current/search"), routes.indexOf("Structured Items Routes"));
  assert(searchBlock.includes("cc.archived_at IS NULL"), "Archived channel filter missing");
});

test("people search scopes to shared channels or shared DMs (visibility guard)", () => {
  const searchBlock = routes.slice(routes.indexOf("GET /api/current/search"), routes.indexOf("Structured Items Routes"));
  assert(
    searchBlock.includes("current_conversation_members cm1") && searchBlock.includes("current_conversation_members cm2"),
    "DM-shared people visibility guard missing"
  );
});

test("sender_id filter only used when > 0 (numeric safe)", () => {
  assert(routes.includes("senderIdParam && senderIdParam > 0"), "sender_id numeric guard missing");
});

test("date_from param strips to ISO-8601 safe chars only", () => {
  assert(routes.includes('[^0-9\\-T:Z]'), "date_from sanitisation missing");
});

// ── Backend: Channel messages load-older ──────────────────────────────────────

test("channel messages route accepts before param", () => {
  assert(routes.includes("beforeParamCh"), "beforeParamCh missing");
  assert(routes.includes("safeBeforeCh"), "safeBeforeCh missing");
});

test("channel messages before param sanitised to ISO-8601 chars", () => {
  assert(
    routes.includes("beforeParamCh.replace(/[^0-9\\-T:Z.]/g, \"\")"),
    "before param sanitisation missing"
  );
});

test("channel messages ORDER BY is conditional on before cursor", () => {
  assert(
    routes.includes("ORDER BY m.created_at ${safeBeforeCh ? \"DESC\" : \"ASC\"}"),
    "Conditional ORDER BY missing"
  );
});

test("channel messages LIMIT is 50 when before cursor supplied", () => {
  assert(
    routes.includes("LIMIT ${safeBeforeCh ? 50 : 200}"),
    "Conditional LIMIT missing"
  );
});

// ── Backend: DM messages load-older ──────────────────────────────────────────

test("DM messages route accepts before param", () => {
  assert(routes.includes("beforeParamDm"), "beforeParamDm missing");
  assert(routes.includes("safeBeforeDm"), "safeBeforeDm missing");
});

test("DM messages before param sanitised to ISO-8601 chars", () => {
  assert(
    routes.includes("beforeParamDm.replace(/[^0-9\\-T:Z.]/g, \"\")"),
    "DM before param sanitisation missing"
  );
});

test("DM messages CTE LIMIT is conditional on before cursor", () => {
  assert(
    routes.includes("LIMIT ${safeBeforeDm ? 50 : 200}"),
    "DM conditional LIMIT missing"
  );
});

// ── Frontend: Interfaces ──────────────────────────────────────────────────────

test("SearchResult interface is optional-field (supports all result types)", () => {
  assert(frontend.includes("resultType?: \"message\" | \"file\" | \"channel\" | \"person\""), "resultType field missing in SearchResult");
  assert(frontend.includes("conversationId?: number | null"), "conversationId field missing");
  assert(frontend.includes("attachmentId?: number"), "attachmentId field missing");
  assert(frontend.includes("displayName?: string"), "displayName field missing");
});

test("SearchResponse interface declared", () => {
  assert(frontend.includes("interface SearchResponse"), "SearchResponse interface missing");
  assert(frontend.includes("items: SearchResult[]"), "items field missing in SearchResponse");
  assert(frontend.includes("totalPages: number"), "totalPages field missing");
});

// ── Frontend: SearchPanel ──────────────────────────────────────────────────────

test("SearchPanel uses SearchResponse type", () => {
  assert(frontend.includes("useQuery<SearchResponse>"), "useQuery<SearchResponse> missing");
});

test("SearchPanel has type filter tabs", () => {
  assert(frontend.includes('data-testid="search-type-tabs"'), "search-type-tabs testid missing");
  assert(frontend.includes('data-testid={`search-tab-${t}`}'), "search-tab-{t} testid missing");
});

test("SearchPanel shows all five types", () => {
  assert(frontend.includes('"all", "messages", "files", "channels", "people"'), "Type array missing in SearchPanel");
});

test("SearchPanel has pagination controls", () => {
  assert(frontend.includes('data-testid="search-pagination"'), "search-pagination testid missing");
  assert(frontend.includes('data-testid="search-page-prev"'), "search-page-prev testid missing");
  assert(frontend.includes('data-testid="search-page-next"'), "search-page-next testid missing");
});

test("SearchPanel shows result count", () => {
  assert(frontend.includes('data-testid="search-result-count"'), "search-result-count testid missing");
});

test("SearchPanel accepts onNavigateDm prop", () => {
  assert(frontend.includes("onNavigateDm?: (convId: number, messageId: number) => void"), "onNavigateDm prop missing");
});

test("SearchPanel passes page/page_size to API", () => {
  assert(frontend.includes("page: String(page)"), "page param missing in search API call");
  assert(frontend.includes("page_size: String(PAGE_SIZE)"), "page_size param missing");
});

test("SearchPanel resets page on new query", () => {
  assert(
    frontend.includes("setDebouncedQ(query.trim()); setPage(1)"),
    "Page reset on new query missing"
  );
});

// ── Frontend: SearchResultCard ────────────────────────────────────────────────

test("SearchResultCard handles file result type", () => {
  assert(frontend.includes('data-testid={`search-result-file-${fileKey}`}'), "file result testid missing");
  assert(frontend.includes("Download →"), "Download CTA missing");
});

test("SearchResultCard handles channel result type", () => {
  assert(frontend.includes('data-testid={`search-result-channel-${result.channelSlug}`}'), "channel result testid missing");
  assert(frontend.includes("Open channel →"), "Open channel CTA missing");
});

test("SearchResultCard handles person result type", () => {
  assert(frontend.includes('data-testid={`search-result-person-${result.userId}`}'), "person result testid missing");
});

test("SearchResultCard handles DM message result (conversationId branch)", () => {
  assert(frontend.includes("result.conversationId"), "conversationId branch missing in SearchResultCard");
});

// ── Frontend: In-conversation search ─────────────────────────────────────────

test("inConvSearchOpen state declared", () => {
  assert(frontend.includes("const [inConvSearchOpen, setInConvSearchOpen]"), "inConvSearchOpen state missing");
});

test("inConvSearchQ and inConvSearchDebounced states declared", () => {
  assert(frontend.includes("const [inConvSearchQ, setInConvSearchQ]"), "inConvSearchQ state missing");
  assert(frontend.includes("const [inConvSearchDebounced, setInConvSearchDebounced]"), "inConvSearchDebounced missing");
});

test("in-conv search panel renders with data-testid", () => {
  assert(frontend.includes('data-testid="in-conv-search-panel"'), "in-conv-search-panel testid missing");
});

test("in-conv search input has testid", () => {
  assert(frontend.includes('data-testid="in-conv-search-input"'), "in-conv-search-input testid missing");
});

test("in-conv search results list has testid", () => {
  assert(frontend.includes('data-testid="in-conv-search-results"'), "in-conv-search-results testid missing");
});

test("in-conv search toggle button has testid", () => {
  assert(frontend.includes('data-testid="btn-conv-search-toggle"'), "btn-conv-search-toggle testid missing");
});

test("in-conv search uses scope=current param", () => {
  assert(frontend.includes("scope: \"current\""), "scope=current missing in in-conv search query");
});

test("in-conv search resets on selectedSlug change", () => {
  assert(
    frontend.includes("setInConvSearchOpen(false)") && frontend.includes("setOlderChannelMsgs([])"),
    "Reset on slug change missing"
  );
});

test("in-conv search uses inConvSearchDebounced as query key", () => {
  assert(
    frontend.includes("['/api/current/search', 'conv'") || frontend.includes('"/api/current/search", "conv"'),
    "in-conv search query key missing"
  );
});

// ── Frontend: Load-older ──────────────────────────────────────────────────────

test("olderChannelMsgs state declared", () => {
  assert(frontend.includes("const [olderChannelMsgs, setOlderChannelMsgs]"), "olderChannelMsgs state missing");
});

test("olderDmMsgs state declared", () => {
  assert(frontend.includes("const [olderDmMsgs, setOlderDmMsgs]"), "olderDmMsgs state missing");
});

test("handleLoadOlderChannel function declared", () => {
  assert(frontend.includes("async function handleLoadOlderChannel()"), "handleLoadOlderChannel missing");
});

test("handleLoadOlderDm function declared", () => {
  assert(frontend.includes("async function handleLoadOlderDm()"), "handleLoadOlderDm missing");
});

test("load-older channel passes before cursor to API", () => {
  assert(
    frontend.includes("/messages?before=${encodeURIComponent(cursor)}"),
    "before cursor param missing in handleLoadOlderChannel"
  );
});

test("load-older channel reverses DESC response to ASC", () => {
  assert(frontend.includes("older.reverse()"), "older.reverse() missing for channel load-older");
});

test("channel load-older button has testid", () => {
  assert(frontend.includes('data-testid="btn-load-older-channel"'), "btn-load-older-channel testid missing");
});

test("DM load-older button has testid", () => {
  assert(frontend.includes('data-testid="btn-load-older-dm"'), "btn-load-older-dm testid missing");
});

test("channel load-older shown when messages.length >= 100", () => {
  assert(frontend.includes("messages.length >= 100"), "messages.length >= 100 threshold missing");
});

test("DM load-older shown when dmMessages.length >= 100", () => {
  assert(frontend.includes("dmMessages.length >= 100"), "dmMessages.length >= 100 threshold missing");
});

test("olderChannelMsgs rendered in feed before live messages", () => {
  const olderChIdx = frontend.indexOf("olderChannelMsgs.map");
  const liveChIdx = frontend.indexOf("{messages.map((msg, i) => {");
  assert(olderChIdx < liveChIdx, "olderChannelMsgs must be rendered before live messages");
});

test("olderDmMsgs rendered in feed before live DM messages", () => {
  const olderDmIdx = frontend.indexOf("olderDmMsgs.map");
  const liveDmIdx = frontend.indexOf("{dmMessages.map((msg, i) => {");
  assert(olderDmIdx < liveDmIdx, "olderDmMsgs must be rendered before live DM messages");
});

// ── Frontend: SearchPanel usage ───────────────────────────────────────────────

test("SearchPanel receives onNavigateDm callback at render site", () => {
  assert(
    frontend.includes("onNavigateDm={(convId, messageId) => {"),
    "onNavigateDm callback missing at SearchPanel render site"
  );
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log("\nCURRENTS Phase 3 — Search + Message History Polish\n");
results.forEach((r) => console.log(r));
console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
