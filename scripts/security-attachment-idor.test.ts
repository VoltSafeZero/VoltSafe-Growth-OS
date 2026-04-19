/**
 * Smoke test for F-09 (attachment IDOR fix).
 *
 * Verifies:
 *   1. Admin can upload an attachment, list it, and download it.
 *   2. Low-perm user (lowperm@voltsafe.com, all permissions=none) cannot:
 *      - list attachments for any object   (expects 403)
 *      - download the attachment by filename (expects 404 — opaque)
 *   3. Path-traversal payloads are rejected (expects 403/404).
 *   4. Unauthenticated requests are rejected (expects 401).
 *
 * Re-uses the seeded test fixture user from scripts/seed-low-perm-user.ts.
 */
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";

interface Resp { status: number; body: any; cookies: string[]; raw: string; }

async function req(
  method: string, urlPath: string,
  opts: { cookie?: string; body?: any; isMultipart?: boolean; headers?: Record<string, string> } = {},
): Promise<Resp> {
  const url = new URL(urlPath, BASE);
  const isMultipart = opts.isMultipart === true;
  let bodyBuf: Buffer | string | undefined;
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.body !== undefined && !isMultipart) {
    bodyBuf = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(bodyBuf));
  } else if (isMultipart) {
    bodyBuf = opts.body as Buffer;
    headers["Content-Length"] = String(bodyBuf.length);
  }
  // Required by csrfOriginGuard for state-changing requests.
  if (!headers["Origin"] && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
    headers["Origin"] = BASE;
  }
  return await new Promise((resolve, reject) => {
    const r = http.request({
      method,
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: any = raw;
        try { body = JSON.parse(raw); } catch {}
        const cookies = (res.headers["set-cookie"] as string[] | undefined) || [];
        resolve({ status: res.statusCode || 0, body, cookies, raw });
      });
    });
    r.on("error", reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

async function login(email: string, password: string): Promise<string> {
  const r = await req("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login(${email}) → ${r.status}: ${r.raw}`);
  const cookie = (r.cookies.find((c) => c.startsWith("connect.sid=")) || "").split(";")[0];
  if (!cookie) throw new Error(`no session cookie returned for ${email}`);
  return cookie;
}

function multipartBody(fields: Record<string, string>, file: { name: string; content: Buffer; mime: string }) {
  const boundary = "----voltsafe-test-" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const results: { label: string; ok: boolean; detail: string }[] = [];
function check(label: string, cond: boolean, detail = "") { results.push({ label, ok: cond, detail }); }

async function main() {
  console.log("\n=== F-09 attachment IDOR smoke test ===\n");

  // 1. Login as admin (trevor) and as low-perm user
  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  console.log("✓ admin login");
  let lowCookie = "";
  try {
    lowCookie = await login("lowperm@voltsafe.com", "lowperm1444");
    console.log("✓ low-perm login");
  } catch (e: any) {
    console.log("⚠ low-perm user not seeded — re-running seed script");
    const { spawnSync } = await import("child_process");
    spawnSync("npx", ["tsx", "scripts/seed-low-perm-user.ts"], { stdio: "inherit" });
    lowCookie = await login("lowperm@voltsafe.com", "lowperm1444");
    console.log("✓ low-perm login (after seed)");
  }

  // 1b. Ensure the low-perm fixture has no `mustChangePassword` flag set —
  //     a global middleware short-circuits to 403 before route handlers run
  //     when this flag is true, which would mask the real ACL gate we want to
  //     test. We clear it directly via the DB (test scaffolding only — this
  //     script is never reachable at runtime in production).
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`UPDATE users SET must_change_password = false WHERE email = 'lowperm@voltsafe.com'`);
  lowCookie = await login("lowperm@voltsafe.com", "lowperm1444");
  console.log("✓ cleared must_change_password flag for low-perm fixture");

  // 2. Find an account to attach to (any will do — admin can see all).
  const acctList = await req("GET", "/api/accounts?limit=1", { cookie: adminCookie });
  const acctRows = Array.isArray(acctList.body) ? acctList.body : (acctList.body?.data || acctList.body?.rows || []);
  if (acctList.status !== 200 || acctRows.length === 0) {
    throw new Error(`failed to list accounts: ${acctList.status} ${acctList.raw.slice(0, 200)}`);
  }
  const acctId = acctRows[0].id;
  console.log(`✓ using account #${acctId}`);

  // 3. Admin uploads a small text attachment.
  const fileContent = Buffer.from(`F-09 IDOR test file — ${Date.now()}`);
  const mp = multipartBody(
    { objectType: "account", objectId: String(acctId), category: "general", title: "F-09 test file" },
    { name: "f09-test.txt", content: fileContent, mime: "text/plain" },
  );
  const uploadResp = await req("POST", "/api/attachments", {
    cookie: adminCookie,
    isMultipart: true,
    body: mp.body,
    headers: { "Content-Type": mp.contentType },
  });
  check("admin upload returns 201", uploadResp.status === 201, `status=${uploadResp.status}`);
  const attachmentId = uploadResp.body?.id;
  const fileName = uploadResp.body?.fileName;
  console.log(`  → uploaded id=${attachmentId} fileName=${fileName}`);

  // 4. Admin can list and download.
  const adminList = await req("GET", `/api/attachments?objectType=account&objectId=${acctId}`, { cookie: adminCookie });
  check("admin list returns 200", adminList.status === 200);
  check("admin list contains uploaded file",
    Array.isArray(adminList.body) && adminList.body.some((a: any) => a.id === attachmentId),
    `body keys: ${Array.isArray(adminList.body) ? adminList.body.length + " items" : typeof adminList.body}`);

  const adminDl = await req("GET", `/api/attachments/file/${fileName}`, { cookie: adminCookie });
  check("admin download returns 200", adminDl.status === 200, `status=${adminDl.status}`);
  check("admin download body matches uploaded content",
    adminDl.raw.includes("F-09 IDOR test file"),
    `body excerpt: ${adminDl.raw.slice(0, 80)}`);

  // 5. Low-perm user CANNOT list attachments → expect 403.
  const lowList = await req("GET", `/api/attachments?objectType=account&objectId=${acctId}`, { cookie: lowCookie });
  check("F-09: low-perm list blocked (403)", lowList.status === 403, `status=${lowList.status} body=${JSON.stringify(lowList.body).slice(0, 100)}`);

  // 6. Low-perm user CANNOT download by filename → expect 404 (opaque).
  const lowDl = await req("GET", `/api/attachments/file/${fileName}`, { cookie: lowCookie });
  check("F-09: low-perm filename download blocked (404)", lowDl.status === 404, `status=${lowDl.status}`);
  check("F-09: low-perm 404 body opaque (no leak of object_type/uploader)",
    !lowDl.raw.includes("account") && !lowDl.raw.includes("uploaded_by"),
    `body: ${lowDl.raw.slice(0, 200)}`);

  // 7. Low-perm user CANNOT download a non-existent fileName either → expect same opaque 404
  //    (no enumeration of "is this filename real?").
  const lowDlMissing = await req("GET", `/api/attachments/file/nonexistent-${Date.now()}.txt`, { cookie: lowCookie });
  check("F-09: low-perm bogus filename also 404 (uniform — no enumeration)", lowDlMissing.status === 404, `status=${lowDlMissing.status}`);

  // 7b. F-09 review fix: uploader is NOT a bypass any more — even if the
  //     low-perm user is recorded as the uploader of this file, they must
  //     still be denied while their section permission is `none`. Force the
  //     uploaded_by column to the low-perm user's id and re-test.
  const meLowAfter = await req("GET", "/api/auth/me", { cookie: lowCookie });
  const lowUserId = meLowAfter.body?.user?.id || meLowAfter.body?.id;
  if (attachmentId && lowUserId) {
    await db.execute(sql`UPDATE attachments SET uploaded_by = ${lowUserId} WHERE id = ${attachmentId}`);
    const lowDlAsOwner = await req("GET", `/api/attachments/file/${fileName}`, { cookie: lowCookie });
    check(
      "F-09 review: ex-uploader with revoked perms still blocked (404)",
      lowDlAsOwner.status === 404,
      `status=${lowDlAsOwner.status}`,
    );
  }

  // 7c. F-09 review fix: GET /api/documents (Document Hub list) now requires
  //     section-view permission. Low-perm user → 403; admin → 200.
  const lowDocs = await req("GET", "/api/documents?limit=10", { cookie: lowCookie });
  check("F-09 review: low-perm Document Hub list blocked (403)", lowDocs.status === 403, `status=${lowDocs.status}`);
  const adminDocs = await req("GET", "/api/documents?limit=10", { cookie: adminCookie });
  check("F-09 review: admin Document Hub list returns 200", adminDocs.status === 200, `status=${adminDocs.status}`);

  // 8. Path traversal is blocked.
  const traversal = await req("GET", `/api/attachments/file/${encodeURIComponent("../../etc/passwd")}`, { cookie: adminCookie });
  check("path traversal blocked (404 via basename)", traversal.status === 404, `status=${traversal.status}`);

  // 9. Unauthenticated download → expect 401.
  const noAuth = await req("GET", `/api/attachments/file/${fileName}`);
  check("unauthenticated download blocked (401)", noAuth.status === 401, `status=${noAuth.status}`);

  // 10. Cleanup — delete the attachment as admin.
  if (attachmentId) {
    const delResp = await req("DELETE", `/api/attachments/${attachmentId}`, { cookie: adminCookie });
    check("admin delete returns 200", delResp.status === 200);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n--- Results ---`);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.label}${r.detail ? `  (${r.detail})` : ""}`);
  console.log(`\n=== ${pass} passed / ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
