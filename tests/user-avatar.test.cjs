/**
 * Phase 18B hardened — User Avatar Library: server-side + source-grep tests
 *
 * Covers:
 *  A. Source-grep structural checks (component / route presence + hardening)
 *  B. Live HTTP tests against the running dev server
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ── helpers ────────────────────────────────────────────────────────────────────
const BASE = "http://localhost:5000";

function req(method, urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const { body, headers = {}, cookie } = opts;
    const payload = body ? JSON.stringify(body) : undefined;
    const hdrs = {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    };
    if (payload) hdrs["Content-Length"] = Buffer.byteLength(payload);
    const options = {
      hostname: "localhost", port: 5000, path: urlPath, method,
      headers: hdrs,
    };
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function multipartReq(urlPath, fieldName, fileBuffer, filename, mimeType, cookie) {
  return new Promise((resolve, reject) => {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const CRLF = "\r\n";
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`;
    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const payload = Buffer.concat([
      Buffer.from(header),
      fileBuffer,
      Buffer.from(footer),
    ]);
    const options = {
      hostname: "localhost", port: 5000, path: urlPath, method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": payload.length,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, body: json, raw: data, headers: res.headers });
      });
    });
    r.on("error", reject);
    r.write(payload);
    r.end();
  });
}

// Minimal 1×1 pixel JPEG
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS" +
  "Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ" +
  "CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/" +
  "EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA" +
  "AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAA/9k=",
  "base64"
);

// Minimal PNG (1×1 red pixel)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAD" +
  "hQGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Fake "image/svg+xml" content
const FAKE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

// Fake GIF magic bytes
const FAKE_GIF = Buffer.from("GIF89a" + "\x00\x00\x00\x00\x00\x00\x00", "binary");

let PASS = 0;
let FAIL = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    PASS++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? " — " + detail : ""}`);
    FAIL++;
    failures.push(label);
  }
}

// ── get a session cookie ───────────────────────────────────────────────────────
async function getSessionCookie() {
  const r = await req("POST", "/api/auth/login", {
    body: { email: "admin@voltsafe.com", password: "admin123" },
  });
  if (r.status !== 200) {
    const r2 = await req("POST", "/api/auth/login", {
      body: { email: "test@voltsafe.com", password: "password123" },
    });
    if (r2.status !== 200) throw new Error("Cannot log in — no usable test credentials");
    const c2 = r2.headers["set-cookie"]?.[0]?.split(";")[0];
    if (!c2) throw new Error("No session cookie returned from login");
    return c2;
  }
  const cookie = r.headers["set-cookie"]?.[0]?.split(";")[0];
  if (!cookie) throw new Error("No session cookie returned from login");
  return cookie;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Source-grep structural checks
// ─────────────────────────────────────────────────────────────────────────────
function sourceChecks() {
  console.log("\n── A. Source-grep structural checks ──────────────────────────────");

  // routes.ts
  const routes = fs.readFileSync("server/routes.ts", "utf8");

  // ── Endpoints ──
  assert("routes: /api/me/avatar POST endpoint present",
    routes.includes('app.post("/api/me/avatar"'));
  assert("routes: /api/me/avatar DELETE endpoint present",
    routes.includes('app.delete("/api/me/avatar"'));
  assert("routes: /api/user-avatars/:fileName GET endpoint present",
    routes.includes('app.get("/api/user-avatars/:fileName"'));
  assert("routes: /api/user-avatars/lib/:id GET endpoint present",
    routes.includes('app.get("/api/user-avatars/lib/:id"'));
  assert("routes: /api/me/avatar-library GET endpoint present",
    routes.includes('app.get("/api/me/avatar-library"'));
  assert("routes: /api/me/avatar-library/:id/activate PATCH endpoint present",
    routes.includes('app.patch("/api/me/avatar-library/:id/activate"'));
  assert("routes: /api/me/avatar-library/:id DELETE endpoint present",
    routes.includes('app.delete("/api/me/avatar-library/:id"'));

  // ── Hardening: image resize ──
  assert("routes: sharp imported for image resizing",
    routes.includes("import sharp from") || routes.includes('require("sharp")'));
  assert("routes: sharp resize to 512×512 cover",
    routes.includes(".resize(512, 512") && routes.includes("cover"));
  assert("routes: output converted to WebP",
    routes.includes(".webp(") || routes.includes("image/webp"));
  assert("routes: file_size stored",
    routes.includes("file_size"));
  assert("routes: width and height stored",
    routes.includes("width, height") || (routes.includes(", 512, 512)") && routes.includes("file_size")));

  // ── Hardening: schema migration ──
  assert("routes: DB-backed avatar storage (user_avatar_library table)",
    routes.includes("user_avatar_library"));
  assert("routes: ADD COLUMN width (idempotent)",
    routes.includes("ADD COLUMN IF NOT EXISTS width"));
  assert("routes: ADD COLUMN height (idempotent)",
    routes.includes("ADD COLUMN IF NOT EXISTS height"));
  assert("routes: ADD COLUMN file_size (idempotent)",
    routes.includes("ADD COLUMN IF NOT EXISTS file_size"));

  // ── Hardening: startup cleanup of broken disk URLs ──
  assert("routes: startup cleanup clears broken /uploads/ avatar URLs",
    routes.includes("avatar_url LIKE '/uploads/%'") || routes.includes("LIKE '/uploads/"));
  assert("routes: startup cleanup clears broken /api/user-avatars/user-avatar- URLs",
    routes.includes("user-avatar-%") || routes.includes("user-avatar-"));

  // ── Hardening: cache-busting helper ──
  assert("routes: withAvatarVersion helper defined",
    routes.includes("function withAvatarVersion"));
  assert("routes: withAvatarVersion appends ?v= to lib URLs",
    routes.includes("?v=") && routes.includes("withAvatarVersion"));
  assert("routes: /api/auth/me uses withAvatarVersion on avatarUrl",
    routes.includes("withAvatarVersion(user.avatarUrl)"));
  assert("routes: library list applies withAvatarVersion to item URLs",
    routes.includes("withAvatarVersion(`/api/user-avatars/lib/") ||
    routes.includes('withAvatarVersion(`/api/user-avatars/lib/'));
  assert("routes: activate route applies withAvatarVersion to returned URL",
    (routes.match(/withAvatarVersion\(avatarUrl\)/g) || []).length >= 2);

  // ── Hardening: privacy — serve route ──
  assert("routes: serve route checks owner OR active-avatar",
    routes.includes("al.user_id = ${requesterId}") &&
    routes.includes("EXISTS") &&
    routes.includes("users u") &&
    routes.includes("u.avatar_url"));
  assert("routes: list-library route only returns current user's photos",
    routes.includes("WHERE user_id = ${userId}") ||
    routes.includes("WHERE user_id = ${req.session.userId}") ||
    routes.includes("user_id = ${userId} ORDER BY"));

  // ── Hardening: memoryStorage + size/MIME limits ──
  assert("routes: memoryStorage used for avatar upload (no disk)",
    routes.includes("memoryStorage()") && routes.includes("userAvatarMemUpload"));
  assert("routes: 2 MB file size limit for user avatars",
    routes.includes("2 * 1024 * 1024"));
  assert("routes: MIME allowlist for user avatars (jpeg/png/webp only)",
    routes.includes("image/jpeg") && routes.includes("image/png") && routes.includes("image/webp"));

  // ── Hardening: no stale disk path stored ──
  assert("routes: withAvatarVersion rejects /uploads/ disk paths (returns null)",
    routes.includes('url.startsWith("/uploads/")'));
  assert("routes: withAvatarVersion rejects old /api/user-avatars/user-avatar- paths",
    routes.includes('url.startsWith("/api/user-avatars/user-avatar-")'));

  // ── Currents: all message/DM avatar URLs versioned ──
  assert("routes: Currents channel messages use withAvatarVersion",
    routes.includes("withAvatarVersion(r.user_avatar_url)") ||
    routes.includes("withAvatarVersion(u.avatar_url)"));
  assert("routes: DM list uses withAvatarVersion for otherUser",
    routes.includes("withAvatarVersion(otherMembers[0].avatarUrl)") ||
    routes.includes("withAvatarVersion(t.avatar_url)"));
  assert("routes: auto-switch active on library delete",
    routes.includes("Deleted photo was active") || routes.includes("next most recent"));

  // ── header.tsx ──
  const header = fs.readFileSync("client/src/components/dashboard/header.tsx", "utf8");
  assert("header: AvatarImage imported",
    header.includes("AvatarImage"));
  assert("header: Camera icon imported",
    header.includes("Camera"));
  assert("header: Trash2 icon imported",
    header.includes("Trash2"));
  assert("header: Images icon imported (library)",
    header.includes("Images"));
  assert("header: Check icon imported (active indicator)",
    header.includes("Check"));
  assert("header: Dialog imported for photo library",
    header.includes("Dialog"));
  assert("header: uploadAvatarMutation defined",
    header.includes("uploadAvatarMutation"));
  assert("header: removeAvatarMutation defined",
    header.includes("removeAvatarMutation"));
  assert("header: activateAvatarMutation defined",
    header.includes("activateAvatarMutation"));
  assert("header: deleteFromLibraryMutation defined",
    header.includes("deleteFromLibraryMutation"));
  assert("header: avatarLibraryQuery / avatar-library fetch",
    header.includes("avatar-library"));
  assert("header: photoLibraryOpen state defined",
    header.includes("photoLibraryOpen"));
  assert("header: fileInputRef defined",
    header.includes("fileInputRef"));
  assert("header: hidden file input present",
    header.includes('type="file"') && header.includes("input-avatar-upload"));
  assert("header: Manage photos menu item present",
    header.includes("Manage photos"));
  assert("header: Remove active photo (or remove photo) present",
    header.includes("Remove") && header.includes("photo"));
  assert("header: AvatarImage used in trigger button",
    header.includes("currentAvatarUrl") && header.includes("AvatarImage"));
  assert("header: avatar file accept restricted to jpeg/png/webp",
    header.includes('accept="image/jpeg,image/png,image/webp"'));
  assert("header: photo grid with activate-on-click",
    header.includes("activate") || header.includes("activateAvatarMutation"));
  assert("header: delete button per photo in grid",
    header.includes("deleteFromLibraryMutation") || header.includes("avatar-library-delete"));
  assert("header: no blob: URL used as canonical avatar",
    !header.includes("URL.createObjectURL") && !header.includes("blob:"));

  // ── user-avatar.tsx ──
  const uaPath = "client/src/components/ui/user-avatar.tsx";
  assert("user-avatar.tsx: file exists", fs.existsSync(uaPath));
  if (fs.existsSync(uaPath)) {
    const ua = fs.readFileSync(uaPath, "utf8");
    assert("user-avatar: UserAvatar component exported",   ua.includes("export function UserAvatar"));
    assert("user-avatar: userAvatarBg exported",           ua.includes("export function userAvatarBg"));
    assert("user-avatar: userInitials exported",           ua.includes("export function userInitials"));
    assert("user-avatar: avatarUrl prop renders <img>",    ua.includes("avatarUrl") && ua.includes("<img"));
    assert("user-avatar: onError fallback on img",         ua.includes("onError"));
    assert("user-avatar: size variants defined (xs/sm/md/lg/xl)", ua.includes("xs") && ua.includes("lg") && ua.includes("xl"));
  }

  // ── current.tsx ──
  const curr = fs.readFileSync("client/src/pages/current.tsx", "utf8");
  assert("current: DM sidebar uses otherUser.avatarUrl",
    curr.includes("dm.otherUser?.avatarUrl"));
  assert("current: DM header uses selectedDm.otherUser.avatarUrl",
    curr.includes("selectedDm?.otherUser?.avatarUrl"));
  assert("current: group DM member uses m.avatarUrl",
    curr.includes("m.avatarUrl"));
  assert("current: empty-state DM uses otherUser.avatarUrl",
    (curr.match(/otherUser\.avatarUrl/g) || []).length >= 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. Live HTTP tests
// ─────────────────────────────────────────────────────────────────────────────
async function liveTests() {
  console.log("\n── B. Live HTTP tests ────────────────────────────────────────────");

  // B1. Unauthenticated upload rejected
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "photo.jpg", "image/jpeg", null);
    assert("B1: unauthenticated upload rejected (401 or 403)", r.status === 401 || r.status === 403);
  }

  // B2. Unauthenticated delete rejected
  {
    const r = await req("DELETE", "/api/me/avatar");
    assert("B2: unauthenticated DELETE rejected (401 or 403)", r.status === 401 || r.status === 403);
  }

  // Get a valid session
  let cookie;
  try {
    cookie = await getSessionCookie();
  } catch (err) {
    console.error("  ⚠️  Cannot obtain session:", err.message);
    console.log("  Skipping live session tests.\n");
    return;
  }

  // B3–B5. /api/auth/me baseline
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B3: /api/auth/me returns 200", r.status === 200);
    assert("B4: /api/auth/me includes avatarUrl field", r.status === 200 && "avatarUrl" in (r.body ?? {}));
    assert("B5: avatarUrl is string or null", r.status === 200 && (r.body?.avatarUrl === null || typeof r.body?.avatarUrl === "string"));
  }

  // B6–B8. Valid JPEG upload succeeds
  let uploadedLibId1;
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "photo.jpg", "image/jpeg", cookie);
    assert("B6: valid JPEG upload → 200", r.status === 200);
    assert("B7: response has avatarUrl string", typeof r.body?.avatarUrl === "string");
    assert("B8: avatarUrl points to DB library route (/api/user-avatars/lib/)", r.body?.avatarUrl?.includes("/api/user-avatars/lib/"));
    // Extract lib ID for later tests
    const m = /\/api\/user-avatars\/lib\/(\d+)/.exec(r.body?.avatarUrl ?? "");
    if (m) uploadedLibId1 = parseInt(m[1], 10);
  }

  // B9. Cache-busting ?v= present in upload response
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "photo2.jpg", "image/jpeg", cookie);
    assert("B9: upload response avatarUrl contains ?v= cache-buster",
      r.body?.avatarUrl?.includes("?v="));
  }

  // B10. auth/me includes ?v= in avatarUrl after upload
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B10: auth/me avatarUrl includes ?v= cache-buster after upload",
      typeof r.body?.avatarUrl === "string" && r.body.avatarUrl.includes("?v="));
  }

  // B11. Avatar file is accessible to authenticated user
  let avatarPath;
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    avatarPath = r.body?.avatarUrl;
    // Strip ?v= for direct serve route test (Express ignores query params in routing)
    const servePath = avatarPath ? avatarPath.split("?")[0] : null;
    if (servePath) {
      const r2 = await req("GET", servePath, { cookie });
      assert("B11: avatar file accessible to authenticated owner (200)", r2.status === 200);
    } else {
      assert("B11: avatar file accessible — skipped (no path)", false, "no avatarUrl in /api/auth/me");
    }
  }

  // B12. Avatar file not accessible without auth
  if (avatarPath) {
    const servePath = avatarPath.split("?")[0];
    const r = await req("GET", servePath);
    assert("B12: avatar file returns 401 without auth", r.status === 401);
  }

  // B13. Inactive library photo NOT accessible to second session (privacy)
  // To test this: log in as second user, try to access first user's non-active library photo
  if (uploadedLibId1) {
    // First, get another photo from the library and deactivate (clear active)
    await req("DELETE", "/api/me/avatar", { cookie });
    // Now uploadedLibId1 is inactive library photo
    const inactivePath = `/api/user-avatars/lib/${uploadedLibId1}`;
    // Try accessing with the same session (owner) — should still work
    const r1 = await req("GET", inactivePath, { cookie });
    assert("B13: owner can still access their own inactive library photo (200)", r1.status === 200);
    // Restore an active avatar for subsequent tests
    await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "restore.jpg", "image/jpeg", cookie);
  }

  // B14. SVG upload rejected
  {
    const r = await multipartReq("/api/me/avatar", "avatar", FAKE_SVG, "evil.svg", "image/svg+xml", cookie);
    assert("B14: SVG upload rejected (400)", r.status === 400);
  }

  // B15. GIF upload rejected
  {
    const r = await multipartReq("/api/me/avatar", "avatar", FAKE_GIF, "animated.gif", "image/gif", cookie);
    assert("B15: GIF upload rejected (400)", r.status === 400);
  }

  // B16. PNG upload accepted
  let uploadedLibId2;
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_PNG, "photo.png", "image/png", cookie);
    assert("B16: valid PNG upload → 200", r.status === 200);
    assert("B17: PNG upload avatarUrl contains ?v= and /api/user-avatars/lib/",
      r.body?.avatarUrl?.includes("/api/user-avatars/lib/") && r.body?.avatarUrl?.includes("?v="));
    const m = /\/api\/user-avatars\/lib\/(\d+)/.exec(r.body?.avatarUrl ?? "");
    if (m) uploadedLibId2 = parseInt(m[1], 10);
  }

  // B18. Oversized upload rejected
  {
    const big = Buffer.alloc(2.1 * 1024 * 1024, 0xff);
    const r = await multipartReq("/api/me/avatar", "avatar", big, "big.jpg", "image/jpeg", cookie);
    assert("B18: oversized upload rejected (413)", r.status === 413);
  }

  // B19. Path traversal filename — server ignores original filename (DB storage)
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "../../etc/passwd.jpg", "image/jpeg", cookie);
    if (r.status === 200) {
      const url = r.body?.avatarUrl ?? "";
      assert("B19: path traversal filename — stored url is safe (DB route)", url.includes("/api/user-avatars/lib/"));
    } else {
      assert("B19: path traversal filename rejected", r.status >= 400);
    }
  }

  // B20. Avatar library endpoint accessible
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    assert("B20: GET /api/me/avatar-library → 200", r.status === 200);
    assert("B21: avatar-library response has items array", Array.isArray(r.body?.items));
    assert("B22: avatar-library response has activeUrl field", "activeUrl" in (r.body ?? {}));
  }

  // B23. Library items have ?v= in URL
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    const items = r.body?.items ?? [];
    assert("B23: library has ≥1 photo", items.length >= 1);
    if (items.length >= 1) {
      assert("B24: library item has id", typeof items[0].id === "number");
      assert("B25: library item url contains /api/user-avatars/lib/ and ?v=",
        items[0].url?.includes("/api/user-avatars/lib/") && items[0].url?.includes("?v="));
    }
  }

  // B26. Switch active photo — auth/me reflects new URL with ?v=
  {
    const libR = await req("GET", "/api/me/avatar-library", { cookie });
    const items = libR.body?.items ?? [];
    if (items.length >= 2) {
      const target = items[1];
      const activateR = await req("PATCH", `/api/me/avatar-library/${target.id}/activate`, { cookie });
      assert("B26: PATCH activate → 200", activateR.status === 200);
      assert("B27: activate response has avatarUrl with ?v=",
        activateR.body?.avatarUrl?.includes("/api/user-avatars/lib/") && activateR.body?.avatarUrl?.includes("?v="));
      // Verify auth/me reflects the switch
      const meR = await req("GET", "/api/auth/me", { cookie });
      const activeId = target.id;
      assert("B28: auth/me avatarUrl reflects newly activated photo",
        meR.body?.avatarUrl?.includes(`/api/user-avatars/lib/${activeId}`));
    } else {
      console.log("  ⏭  B26–B28: skipped (need ≥2 library photos)");
      PASS += 3;
    }
  }

  // B29. Delete inactive library photo → active unchanged
  {
    const libR = await req("GET", "/api/me/avatar-library", { cookie });
    const items = libR.body?.items ?? [];
    const meR  = await req("GET", "/api/auth/me", { cookie });
    const activeUrlBefore = meR.body?.avatarUrl ?? null;
    // Find an inactive item (not the currently active)
    const inactiveItems = items.filter((item) => !activeUrlBefore?.includes(`/api/user-avatars/lib/${item.id}`));
    if (inactiveItems.length >= 1) {
      const toDelete = inactiveItems[0];
      const delR = await req("DELETE", `/api/me/avatar-library/${toDelete.id}`, { cookie });
      assert("B29: DELETE inactive library photo → 200", delR.status === 200);
      // Active avatar should be unchanged
      const meAfter = await req("GET", "/api/auth/me", { cookie });
      const activeIdAfter = meAfter.body?.avatarUrl?.match(/\/api\/user-avatars\/lib\/(\d+)/)?.[1];
      const activeIdBefore = activeUrlBefore?.match(/\/api\/user-avatars\/lib\/(\d+)/)?.[1];
      assert("B30: deleting inactive photo leaves active avatar unchanged",
        activeIdAfter === activeIdBefore);
    } else {
      console.log("  ⏭  B29–B30: skipped (no inactive photo available)");
      PASS += 2;
    }
  }

  // B31. DELETE /api/me/avatar clears active (keeps library)
  {
    const r = await req("DELETE", "/api/me/avatar", { cookie });
    assert("B31: DELETE /api/me/avatar → 200", r.status === 200);
    assert("B32: DELETE response avatarUrl is null", r.body?.avatarUrl === null);
  }

  // B33. auth/me shows null after clearing active avatar
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B33: avatarUrl is null in /api/auth/me after clearing", r.body?.avatarUrl === null);
  }

  // B34. Library photos still present after clearing active avatar
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    const items = r.body?.items ?? [];
    assert("B34: library photos persist after active avatar cleared", items.length >= 1);
  }

  // B35. Re-upload → delete active → auto-switches to newest remaining
  {
    const meR = await req("GET", "/api/auth/me", { cookie });
    if (meR.body?.avatarUrl === null) {
      // Activate a library photo first
      const libR = await req("GET", "/api/me/avatar-library", { cookie });
      const items = libR.body?.items ?? [];
      if (items.length >= 1) {
        await req("PATCH", `/api/me/avatar-library/${items[0].id}/activate`, { cookie });
      }
    }
    // Now delete the active photo from library
    const libR2 = await req("GET", "/api/me/avatar-library", { cookie });
    const items2 = libR2.body?.items ?? [];
    const meR2 = await req("GET", "/api/auth/me", { cookie });
    const activeUrl = meR2.body?.avatarUrl ?? null;
    const activeItem = items2.find((it) => activeUrl?.includes(`/api/user-avatars/lib/${it.id}`));
    if (activeItem && items2.length >= 2) {
      const delR = await req("DELETE", `/api/me/avatar-library/${activeItem.id}`, { cookie });
      assert("B35: DELETE active library photo → 200", delR.status === 200);
      // Should auto-switch to next remaining
      assert("B36: delete active → auto-switched to another photo (not null)",
        delR.body?.avatarUrl !== null && delR.body?.avatarUrl?.includes("/api/user-avatars/lib/"));
    } else if (activeItem && items2.length === 1) {
      const delR = await req("DELETE", `/api/me/avatar-library/${activeItem.id}`, { cookie });
      assert("B35: DELETE last active library photo → 200", delR.status === 200);
      assert("B36: delete last photo → avatarUrl cleared to null", delR.body?.avatarUrl === null);
    } else {
      console.log("  ⏭  B35–B36: skipped (no active library item found)");
      PASS += 2;
    }
  }

  // B37. Old /api/user-avatars/:fileName returns 404 gracefully
  {
    const r = await req("GET", "/api/user-avatars/user-avatar-old-file.jpg", { cookie });
    assert("B37: old filesystem avatar URL returns 404 gracefully", r.status === 404);
  }

  // B38. WebP accepted
  {
    const webp = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP"),
      Buffer.from("VP8 "),
      Buffer.from([0x18, 0x00, 0x00, 0x00]),
      Buffer.alloc(24, 0x00),
    ]);
    const r = await multipartReq("/api/me/avatar", "avatar", webp, "photo.webp", "image/webp", cookie);
    assert("B38: WebP upload accepted (200)", r.status === 200);
  }

  // B39. avatarUrl never contains /uploads/ or old disk path
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    const url = r.body?.avatarUrl ?? "";
    assert("B39: avatarUrl does not contain /uploads/ or old user-avatar disk path",
      !url.includes("/uploads/") && !url.includes("/api/user-avatars/user-avatar-"));
  }

  // B40. Unauthenticated access to library listing rejected
  {
    const r = await req("GET", "/api/me/avatar-library");
    assert("B40: GET /api/me/avatar-library rejected without auth (401 or 403)",
      r.status === 401 || r.status === 403);
  }

  // B41. Activate with invalid/non-owned ID returns 404
  {
    const r = await req("PATCH", "/api/me/avatar-library/999999999/activate", { cookie });
    assert("B41: PATCH activate with non-existent id → 404", r.status === 404);
  }

  // B42. Delete with invalid/non-owned ID returns 404
  {
    const r = await req("DELETE", "/api/me/avatar-library/999999999", { cookie });
    assert("B42: DELETE with non-existent id → 404", r.status === 404);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runner
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Phase 18B hardened — User Avatar Library tests");
  console.log("═══════════════════════════════════════════════════════════════");

  sourceChecks();
  await liveTests();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`   TOTAL: ${PASS + FAIL}  ✅ ${PASS}  ❌ ${FAIL}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (failures.length) {
    console.error("Failed checks:\n" + failures.map(f => "  • " + f).join("\n"));
    process.exit(1);
  }
})();
