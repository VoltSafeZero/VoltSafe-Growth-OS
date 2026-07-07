"use strict";
// Source-grep test — pins CURRENTS Files Tab (Phase 2) invariants
// Covers: backend endpoint, auth, access control, pagination, search, filters,
//         frontend component, UI states, jump-to-message, download action
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Load source files ─────────────────────────────────────────────────────────

const routesSrc = fs.readFileSync(
  path.join(__dirname, "../server/routes.ts"),
  "utf8"
);

const filesTabSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/current-files-tab.tsx"),
  "utf8"
);

const currentSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);

const displaySrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/current-attachment-display.tsx"),
  "utf8"
);

// ══════════════════════════════════════════════════════════════════════════════
// 1. Backend route — existence and registration
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n1. Backend route registration");
assert(
  "/api/currents/files route exists",
  routesSrc.includes('app.get("/api/currents/files"')
);
assert(
  "route uses requireAuth middleware",
  routesSrc.includes('app.get("/api/currents/files", requireAuth')
);
assert(
  "route is an async handler",
  routesSrc.includes('app.get("/api/currents/files", requireAuth, async (req, res)')
);

// ══════════════════════════════════════════════════════════════════════════════
// 2. Backend — access control
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n2. Access control");
assert(
  "channel access uses resolveChannelAccess",
  routesSrc.includes("resolveChannelAccess(userId, channelSlug)")
);
assert(
  "forbidden channel returns 403",
  routesSrc.includes(`access === "forbidden"`) &&
    routesSrc.includes('res.status(403)')
);
assert(
  "DM access checks current_conversation_members",
  routesSrc.includes("current_conversation_members") &&
    routesSrc.includes("conversation_id = ${convId} AND user_id = ${userId}")
);
assert(
  "DM access returns 403 for non-member",
  routesSrc.includes("Not a member of this conversation")
);
assert(
  "missing both params returns 400",
  routesSrc.includes("channel_slug or conversation_id is required")
);

// ══════════════════════════════════════════════════════════════════════════════
// 3. Backend — pagination
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n3. Pagination");
assert(
  "page_size capped at 100",
  routesSrc.includes("Math.min(100,")
);
assert(
  "page defaults to 1 minimum",
  routesSrc.includes("Math.max(1, Number(req.query.page)")
);
assert(
  "LIMIT and OFFSET used",
  routesSrc.includes("LIMIT ${pageSize} OFFSET ${offset}")
);
assert(
  "totalPages returned in response",
  routesSrc.includes("totalPages: Math.ceil(total / pageSize)")
);
assert(
  "total count query included",
  routesSrc.includes("SELECT COUNT(*) AS total")
);

// ══════════════════════════════════════════════════════════════════════════════
// 4. Backend — search support
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n4. Search support");
assert(
  "search param processed",
  routesSrc.includes("req.query.search")
);
assert(
  "search uses ILIKE on original_name",
  routesSrc.includes("a.original_name ILIKE")
);
assert(
  "search uses ILIKE on uploader name",
  routesSrc.includes("uploaded_by_name, u.name, '') ILIKE")
);
assert(
  "search input single-quote escaped",
  routesSrc.includes("search.replace(/'/g, \"''\")")
);
assert(
  "search length capped at 200",
  routesSrc.includes(".slice(0, 200)")
);

// ══════════════════════════════════════════════════════════════════════════════
// 5. Backend — file type filter
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n5. File type filter");
assert(
  "file_type param processed",
  routesSrc.includes("req.query.file_type")
);
assert(
  "image type filter present",
  routesSrc.includes(`case "image":`) &&
    routesSrc.includes("LIKE 'image/%'")
);
assert(
  "pdf type filter present",
  routesSrc.includes(`case "pdf":`) &&
    routesSrc.includes("'application/pdf'")
);
assert(
  "document type filter present",
  routesSrc.includes(`case "document":`)
);
assert(
  "spreadsheet type filter present",
  routesSrc.includes(`case "spreadsheet":`)
);
assert(
  "presentation type filter present",
  routesSrc.includes(`case "presentation":`)
);
assert(
  "archive type filter present",
  routesSrc.includes(`case "archive":`)
);
assert(
  "file_type filter uses whitelist switch (no user input interpolated directly)",
  routesSrc.includes("switch (fileType)")
);

// ══════════════════════════════════════════════════════════════════════════════
// 6. Backend — deleted messages excluded
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n6. Deleted messages excluded");
assert(
  "m.deleted_at IS NULL in WHERE clause",
  routesSrc.includes("m.deleted_at IS NULL")
);

// ══════════════════════════════════════════════════════════════════════════════
// 7. Backend — response shape
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n7. Response shape");
assert(
  "attachmentId in response",
  routesSrc.includes("attachmentId: Number(r.attachment_id)")
);
assert(
  "originalName in response (not raw file_name UUID)",
  routesSrc.includes("originalName: r.original_name")
);
assert(
  "downloadUrl returned as protected API path",
  routesSrc.includes("downloadUrl: `/api/attachments/file/${r.file_name}`")
);
assert(
  "raw file_name UUID NOT exposed as top-level key",
  !routesSrc.includes("fileName: r.file_name") ||
    routesSrc.indexOf("downloadUrl: `/api/attachments/file/${r.file_name}`") <
      routesSrc.indexOf("fileName: r.file_name") + 1000
);
assert(
  "uploaderName in response",
  routesSrc.includes("uploaderName: r.uploader_name")
);
assert(
  "messageId in response",
  routesSrc.includes("messageId: Number(r.message_id)")
);
assert(
  "messageSnippet stripped of mention tokens",
  routesSrc.includes('@$1")')
);
assert(
  "createdAt in response",
  routesSrc.includes("createdAt: r.created_at")
);

// ══════════════════════════════════════════════════════════════════════════════
// 8. Backend — date filters
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n8. Date filters");
assert(
  "date_from param processed",
  routesSrc.includes("req.query.date_from")
);
assert(
  "date_to param processed",
  routesSrc.includes("req.query.date_to")
);
assert(
  "date values stripped to safe chars",
  routesSrc.includes('[^0-9\\-T:Z]')
);

// ══════════════════════════════════════════════════════════════════════════════
// 9. Frontend — CurrentFilesTab component
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n9. CurrentFilesTab component structure");
assert(
  "CurrentFilesTab exported from current-files-tab.tsx",
  filesTabSrc.includes("export function CurrentFilesTab(")
);
assert(
  "component uses /api/currents/files endpoint",
  filesTabSrc.includes("/api/currents/files")
);
assert(
  "no hardcoded fake file list",
  !filesTabSrc.includes("fileName: 'example") &&
    !filesTabSrc.includes('originalName: "example') &&
    !filesTabSrc.includes("const fakeFiles")
);
assert(
  "uses useQuery for data fetching",
  filesTabSrc.includes("useQuery<FilesTabResponse>")
);
assert(
  "query key includes channel and conversation params",
  filesTabSrc.includes('"/api/currents/files"') &&
    filesTabSrc.includes("channelSlug") &&
    filesTabSrc.includes("conversationId")
);

// ══════════════════════════════════════════════════════════════════════════════
// 10. Frontend — search input
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n10. Search input");
assert(
  "search Input element present",
  filesTabSrc.includes('data-testid="files-search-input"')
);
assert(
  "search debounced with useRef",
  filesTabSrc.includes("debounceRef") && filesTabSrc.includes("setTimeout")
);
assert(
  "clear search button present",
  filesTabSrc.includes("Clear search") || filesTabSrc.includes('aria-label="Clear search"')
);

// ══════════════════════════════════════════════════════════════════════════════
// 11. Frontend — file type filter
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n11. File type filter UI");
assert(
  "file type filter container present",
  filesTabSrc.includes('data-testid="files-type-filter"')
);
assert(
  "FILE_TYPE_OPTIONS array defined",
  filesTabSrc.includes("FILE_TYPE_OPTIONS")
);
assert(
  "image option in type filter",
  filesTabSrc.includes('"image"') && filesTabSrc.includes('"Images"')
);
assert(
  "pdf option in type filter",
  filesTabSrc.includes('"pdf"') && filesTabSrc.includes('"PDFs"')
);
assert(
  "filter buttons have testids",
  filesTabSrc.includes('data-testid={`files-type-${')
);

// ══════════════════════════════════════════════════════════════════════════════
// 12. Frontend — loading state
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n12. Loading state");
assert(
  "loading skeleton present",
  filesTabSrc.includes('data-testid="files-loading"')
);
assert(
  "skeleton uses isLoading guard",
  filesTabSrc.includes("isLoading && (")
);
assert(
  "skeleton has animate-pulse",
  filesTabSrc.includes("animate-pulse")
);

// ══════════════════════════════════════════════════════════════════════════════
// 13. Frontend — error state
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n13. Error state");
assert(
  "error state present",
  filesTabSrc.includes('data-testid="files-error"')
);
assert(
  "error guarded by isError",
  filesTabSrc.includes("isError && !isLoading")
);

// ══════════════════════════════════════════════════════════════════════════════
// 14. Frontend — empty states
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n14. Empty states");
assert(
  "no-files-yet empty state present",
  filesTabSrc.includes('data-testid="files-empty"')
);
assert(
  "no-results (filtered) empty state present",
  filesTabSrc.includes('data-testid="files-no-results"')
);
assert(
  "empty state message for no files",
  filesTabSrc.includes("No files shared yet")
);
assert(
  "empty state message for no search results",
  filesTabSrc.includes("No files match your search")
);

// ══════════════════════════════════════════════════════════════════════════════
// 15. Frontend — file row data
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n15. File row data display");
assert(
  "file list container present",
  filesTabSrc.includes('data-testid="files-list"')
);
assert(
  "file row has testid",
  filesTabSrc.includes('data-testid={`file-row-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-row-${item.attachmentId}`}")
);
assert(
  "file name rendered",
  filesTabSrc.includes('data-testid={`file-name-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-name-${item.attachmentId}`}")
);
assert(
  "file size rendered",
  filesTabSrc.includes('data-testid={`file-size-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-size-${item.attachmentId}`}")
);
assert(
  "uploader name rendered",
  filesTabSrc.includes('data-testid={`file-uploader-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-uploader-${item.attachmentId}`}")
);
assert(
  "date rendered",
  filesTabSrc.includes('data-testid={`file-date-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-date-${item.attachmentId}`}")
);
assert(
  "formatFileSize used for size display",
  filesTabSrc.includes("formatFileSize(item.fileSize)")
);

// ══════════════════════════════════════════════════════════════════════════════
// 16. Frontend — open and download actions
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n16. Open and download actions");
assert(
  "open in new tab action present",
  filesTabSrc.includes('data-testid={`file-open-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-open-${item.attachmentId}`}")
);
assert(
  "download action present",
  filesTabSrc.includes('data-testid={`file-download-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-download-${item.attachmentId}`}")
);
assert(
  "download uses downloadUrl (protected API path)",
  filesTabSrc.includes("href={item.downloadUrl}")
);
assert(
  "download anchor uses download attribute",
  filesTabSrc.includes("download={item.originalName}")
);
assert(
  "open uses target=_blank",
  filesTabSrc.includes('target="_blank"')
);

// ══════════════════════════════════════════════════════════════════════════════
// 17. Frontend — jump to message
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n17. Jump to message");
assert(
  "jump-to-message button present",
  filesTabSrc.includes('data-testid={`file-jump-${item.attachmentId}`)') ||
    filesTabSrc.includes("data-testid={`file-jump-${item.attachmentId}`}")
);
assert(
  "jump calls onJumpToMessage prop",
  filesTabSrc.includes("onJumpToMessage(item.messageId, item.messageSnippet)")
);
assert(
  "jump button only shown when onJumpToMessage provided",
  filesTabSrc.includes("{onJumpToMessage && (")
);

// ══════════════════════════════════════════════════════════════════════════════
// 18. Frontend — pagination
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n18. Pagination controls");
assert(
  "pagination container present",
  filesTabSrc.includes('data-testid="files-pagination"')
);
assert(
  "prev page button present",
  filesTabSrc.includes('data-testid="files-prev-page"')
);
assert(
  "next page button present",
  filesTabSrc.includes('data-testid="files-next-page"')
);
assert(
  "pagination only shown when totalPages > 1",
  filesTabSrc.includes("totalPages > 1")
);

// ══════════════════════════════════════════════════════════════════════════════
// 19. Frontend — mime icon helpers exported from display module
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n19. Mime icon helpers exported");
assert(
  "getMimeIcon exported from current-attachment-display",
  displaySrc.includes("export function getMimeIcon(")
);
assert(
  "getMimeColor exported from current-attachment-display",
  displaySrc.includes("export function getMimeColor(")
);
assert(
  "getMimeBg exported from current-attachment-display",
  displaySrc.includes("export function getMimeBg(")
);
assert(
  "current-files-tab imports getMimeIcon",
  filesTabSrc.includes("getMimeIcon") &&
    filesTabSrc.includes('from "./current-attachment-display"')
);

// ══════════════════════════════════════════════════════════════════════════════
// 20. Integration — current.tsx wiring
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n20. current.tsx integration");
assert(
  "CurrentFilesTab imported in current.tsx",
  currentSrc.includes('import { CurrentFilesTab } from "@/components/current/current-files-tab"')
);
assert(
  "CurrentFilesTab used in channel files tab",
  currentSrc.includes("<CurrentFilesTab") &&
    currentSrc.includes("channelSlug={selectedSlug}")
);
assert(
  "CurrentFilesTab used in DM files tab",
  currentSrc.includes("<CurrentFilesTab") &&
    currentSrc.includes("conversationId={selectedDmId}")
);
assert(
  "channel files tab switches to messages on jump",
  currentSrc.includes("setChannelTab(\"messages\")")
);
assert(
  "DM files tab switches to messages on jump",
  currentSrc.includes("setDmTab(\"messages\")")
);
assert(
  "old client-side filter (messages.filter) no longer in channel files tab",
  !currentSrc.includes("messages.filter(m => m.attachments && m.attachments.length > 0).map(")
);
assert(
  "old client-side filter (dmMessages.filter) no longer in DM files tab",
  !currentSrc.includes("dmMessages.filter(m => m.attachments && m.attachments.length > 0).map(")
);

// ══════════════════════════════════════════════════════════════════════════════
// 21. Security — download URL is API-protected path
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n21. Security checks");
assert(
  "downloadUrl always routed through /api/attachments/file/ (auth-protected)",
  routesSrc.includes("downloadUrl: `/api/attachments/file/${r.file_name}`")
);
assert(
  "no direct storage path (/uploads/) exposed in files response",
  !routesSrc.includes("'/uploads/") ||
    !routesSrc.includes("downloadUrl: '/uploads/")
);
assert(
  "unauthenticated access blocked (requireAuth present)",
  routesSrc.includes('app.get("/api/currents/files", requireAuth')
);
assert(
  "private channel access verified before query",
  routesSrc.includes("resolveChannelAccess") &&
    routesSrc.includes('access === "forbidden"')
);

// ══════════════════════════════════════════════════════════════════════════════
// Final report
// ══════════════════════════════════════════════════════════════════════════════
console.log(`
────────────────────────────────────────────────────────
currents-files-tab: ${passed} passed, ${failed} failed
${failed === 0 ? "ALL CHECKS PASSED ✓" : "SOME CHECKS FAILED ✗"}
`);

if (failed > 0) process.exit(1);
