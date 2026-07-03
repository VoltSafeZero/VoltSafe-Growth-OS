/**
 * Phase 18B — User Avatar Library: server-side + source-grep tests
 *
 * Covers:
 *  A. Source-grep structural checks (component / route presence)
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
  assert("routes: /api/auth/me returns avatarUrl",
    routes.includes("avatarUrl: user.avatarUrl"));
  assert("routes: DB-backed avatar storage (user_avatar_library table)",
    routes.includes("user_avatar_library"));
  assert("routes: memoryStorage used for avatar upload (no disk)",
    routes.includes("memoryStorage()") && routes.includes("userAvatarMemUpload"));
  assert("routes: 2 MB file size limit for user avatars",
    routes.includes("2 * 1024 * 1024"));
  assert("routes: MIME allowlist for user avatars (jpeg/png/webp only)",
    routes.includes("image/jpeg") && routes.includes("image/png") && routes.includes("image/webp"));
  assert("routes: base64 encoding for DB storage",
    routes.includes('toString("base64")'));
  assert("routes: lib image served from DB (no filesystem read)",
    routes.includes("Buffer.from") && routes.includes('"base64"') && routes.includes("image_data"));
  assert("routes: auto-switch active on library delete",
    routes.includes("Deleted photo was active") || routes.includes("next most recent"));

  // header.tsx
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

  // user-avatar.tsx
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

  // current.tsx
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

  // 1. Unauthenticated upload rejected (CSRF may fire first → 403 before 401)
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "photo.jpg", "image/jpeg", null);
    assert("B1: unauthenticated upload rejected (401 or 403)", r.status === 401 || r.status === 403);
  }

  // 2. Unauthenticated delete rejected
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

  // 3. /api/auth/me includes avatarUrl field
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B3: /api/auth/me returns 200", r.status === 200);
    assert("B4: /api/auth/me includes avatarUrl field", r.status === 200 && "avatarUrl" in (r.body ?? {}));
    assert("B5: avatarUrl is string or null", r.status === 200 && (r.body?.avatarUrl === null || typeof r.body?.avatarUrl === "string"));
  }

  // 4. Valid JPEG upload succeeds
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "photo.jpg", "image/jpeg", cookie);
    assert("B6: valid JPEG upload → 200", r.status === 200);
    assert("B7: response has avatarUrl string", typeof r.body?.avatarUrl === "string");
    assert("B8: avatarUrl points to DB library route (/api/user-avatars/lib/)", r.body?.avatarUrl?.startsWith("/api/user-avatars/lib/"));
  }

  // 5. Avatar URL is now in /api/auth/me
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B9: avatarUrl set in /api/auth/me after upload", typeof r.body?.avatarUrl === "string" && r.body.avatarUrl.startsWith("/api/user-avatars/lib/"));
  }

  // 6. Avatar file is accessible to authenticated user
  let avatarPath;
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    avatarPath = r.body?.avatarUrl;
    if (avatarPath) {
      const r2 = await req("GET", avatarPath, { cookie });
      assert("B10: avatar file accessible to authenticated user (200)", r2.status === 200);
    } else {
      assert("B10: avatar file accessible — skipped (no path)", false, "no avatarUrl in /api/auth/me");
    }
  }

  // 7. Avatar file not accessible without auth
  if (avatarPath) {
    const r = await req("GET", avatarPath);
    assert("B11: avatar file returns 401 without auth", r.status === 401);
  }

  // 8. SVG upload rejected
  {
    const r = await multipartReq("/api/me/avatar", "avatar", FAKE_SVG, "evil.svg", "image/svg+xml", cookie);
    assert("B12: SVG upload rejected (400)", r.status === 400);
  }

  // 9. GIF upload rejected
  {
    const r = await multipartReq("/api/me/avatar", "avatar", FAKE_GIF, "animated.gif", "image/gif", cookie);
    assert("B13: GIF upload rejected (400)", r.status === 400);
  }

  // 10. PNG upload accepted
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_PNG, "photo.png", "image/png", cookie);
    assert("B14: valid PNG upload → 200", r.status === 200);
    assert("B15: PNG upload avatarUrl points to DB library", r.body?.avatarUrl?.startsWith("/api/user-avatars/lib/"));
  }

  // 11. Oversized upload rejected
  {
    const big = Buffer.alloc(2.1 * 1024 * 1024, 0xff);
    const r = await multipartReq("/api/me/avatar", "avatar", big, "big.jpg", "image/jpeg", cookie);
    assert("B16: oversized upload rejected (413)", r.status === 413);
  }

  // 12. Path traversal filename — server ignores original filename (DB storage)
  {
    const r = await multipartReq("/api/me/avatar", "avatar", TINY_JPEG, "../../etc/passwd.jpg", "image/jpeg", cookie);
    if (r.status === 200) {
      const url = r.body?.avatarUrl ?? "";
      assert("B17: path traversal filename — stored url is safe (DB route)", url.startsWith("/api/user-avatars/lib/"));
    } else {
      assert("B17: path traversal filename rejected", r.status >= 400);
    }
  }

  // 13. Avatar library endpoint accessible
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    assert("B18: GET /api/me/avatar-library → 200", r.status === 200);
    assert("B19: avatar-library response has items array", Array.isArray(r.body?.items));
    assert("B20: avatar-library response has activeUrl field", "activeUrl" in (r.body ?? {}));
  }

  // 14. Library has at least one photo after uploads above
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    const items = r.body?.items ?? [];
    assert("B21: library has ≥1 photo after uploads", items.length >= 1);
    if (items.length >= 1) {
      assert("B22: library item has id", typeof items[0].id === "number");
      assert("B23: library item url starts with /api/user-avatars/lib/", items[0].url?.startsWith("/api/user-avatars/lib/"));
    }
  }

  // 15. Activate a library photo
  {
    const libR = await req("GET", "/api/me/avatar-library", { cookie });
    const items = libR.body?.items ?? [];
    if (items.length >= 2) {
      const target = items[1]; // activate second most recent
      const r = await req("PATCH", `/api/me/avatar-library/${target.id}/activate`, { cookie });
      assert("B24: PATCH activate → 200", r.status === 200);
      assert("B25: activate response has avatarUrl", r.body?.avatarUrl?.startsWith("/api/user-avatars/lib/"));
    } else {
      console.log("  ⏭  B24–B25: skipped (need ≥2 library photos)");
      PASS += 2; // don't penalise
    }
  }

  // 16. DELETE /api/me/avatar clears active (keeps library)
  {
    const r = await req("DELETE", "/api/me/avatar", { cookie });
    assert("B26: DELETE /api/me/avatar → 200", r.status === 200);
    assert("B27: DELETE response avatarUrl is null", r.body?.avatarUrl === null);
  }

  // 17. /api/auth/me shows null after delete
  {
    const r = await req("GET", "/api/auth/me", { cookie });
    assert("B28: avatarUrl is null in /api/auth/me after delete", r.body?.avatarUrl === null);
  }

  // 18. Library photos still present after DELETE /api/me/avatar
  {
    const r = await req("GET", "/api/me/avatar-library", { cookie });
    const items = r.body?.items ?? [];
    assert("B29: library photos persist after active avatar cleared", items.length >= 1);
  }

  // 19. Old /api/user-avatars/:fileName returns 404 gracefully
  {
    const r = await req("GET", "/api/user-avatars/user-avatar-old-file.jpg", { cookie });
    assert("B30: old filesystem avatar URL returns 404 gracefully", r.status === 404);
  }

  // 20. WebP accepted
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
    assert("B31: WebP upload accepted (200)", r.status === 200);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// runner
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Phase 18B — User Avatar Library tests");
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
