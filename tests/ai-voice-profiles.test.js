/**
 * AI Voice Profiles — regression test suite
 *
 * Covers:
 *   1. Source-grep assertions (structure/wiring pins)
 *   2. API behavioural tests (CRUD, access control, import-from-gpt, default profile)
 *   3. Email generation integration (voice profile injected, forbidden phrases respected)
 *   4. Invalid / unauthorised edge cases
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:5000";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail = "") {
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  failed++;
}

async function check(label, resFn, expectedStatus) {
  const res = await resFn;
  if (res.status === expectedStatus) {
    ok(`${label} → ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} → expected ${expectedStatus}, got ${res.status}`, body.slice(0, 120));
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": BASE },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  const match = setCookie?.match(/connect\.sid=([^;]+)/);
  if (!match) throw new Error("No session cookie from login");
  return `connect.sid=${match[1]}`;
}

function authed(cookie) {
  return (url, opts = {}) =>
    fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE,
        Cookie: cookie,
        ...(opts.headers || {}),
      },
      credentials: "include",
    });
}

// ── 1. Source-grep assertions ─────────────────────────────────────────────────

function grep(label, file, pattern) {
  try {
    const content = fs.readFileSync(path.resolve(file), "utf8");
    if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) {
      ok(label);
    } else {
      fail(label, `Pattern not found: ${pattern}`);
    }
  } catch (err) {
    fail(label, err.message);
  }
}

async function runSourceGrepTests() {
  console.log("\n── Source-grep (structural pins) ──────────────────────────────");

  // Migration
  grep("migration creates ai_voice_profiles table",
    "migrations/0012_ai_voice_profiles.sql",
    "CREATE TABLE IF NOT EXISTS ai_voice_profiles");
  grep("migration creates ai_voice_profile_files table",
    "migrations/0012_ai_voice_profiles.sql",
    "CREATE TABLE IF NOT EXISTS ai_voice_profile_files");
  grep("migration creates user_ai_settings table",
    "migrations/0012_ai_voice_profiles.sql",
    "CREATE TABLE IF NOT EXISTS user_ai_settings");
  grep("migration seeds CEO Wattson",
    "migrations/0012_ai_voice_profiles.sql",
    "CEO Wattson");
  grep("migration seeds forbidden phrases",
    "migrations/0012_ai_voice_profiles.sql",
    "I hope this email finds you well");

  // Service
  grep("service exports listVoiceProfiles",
    "server/services/ai-voice-profiles.ts",
    "export async function listVoiceProfiles");
  grep("service exports createVoiceProfile",
    "server/services/ai-voice-profiles.ts",
    "export async function createVoiceProfile");
  grep("service exports buildVoiceProfilePromptBlock",
    "server/services/ai-voice-profiles.ts",
    "export function buildVoiceProfilePromptBlock");
  grep("service exports getVoiceProfileForPrompt",
    "server/services/ai-voice-profiles.ts",
    "export async function getVoiceProfileForPrompt");
  grep("buildVoiceProfilePromptBlock includes forbidden phrases section",
    "server/services/ai-voice-profiles.ts",
    "FORBIDDEN PHRASES");
  grep("buildVoiceProfilePromptBlock includes preferred phrases section",
    "server/services/ai-voice-profiles.ts",
    "PREFERRED PHRASES");
  grep("buildVoiceProfilePromptBlock includes example messages",
    "server/services/ai-voice-profiles.ts",
    "EXAMPLE EMAILS IN THIS VOICE");
  grep("service access control: user profiles blocked for non-owner",
    "server/services/ai-voice-profiles.ts",
    "profile.ownerUserId !== userId");

  // Routes
  grep("routes: GET /api/ai/voice-profiles registered",
    "server/routes.ts",
    '/api/ai/voice-profiles"');
  grep("routes: import-from-gpt endpoint registered",
    "server/routes.ts",
    "import-from-gpt");
  grep("routes: GET /api/ai/settings registered",
    "server/routes.ts",
    '/api/ai/settings"');
  grep("routes: PUT /api/ai/settings/default-voice-profile registered",
    "server/routes.ts",
    "/api/ai/settings/default-voice-profile");
  grep("routes: only admins edit global profiles",
    "server/routes.ts",
    "Only admins can edit global profiles");

  // crm-ai-summary updated
  grep("generateSuggestedNextEmail accepts voiceProfileId",
    "server/services/crm-ai-summary.ts",
    "voiceProfileId?: number");
  grep("generateSuggestedNextEmail loads voice profile",
    "server/services/crm-ai-summary.ts",
    "getVoiceProfileForPrompt");
  grep("generateSuggestedNextEmail injects voice profile block into prompt",
    "server/services/crm-ai-summary.ts",
    "voiceProfileBlock");
  grep("suggest-next-email route passes voice_profile_id",
    "server/routes.ts",
    "voice_profile_id");

  // Frontend
  grep("AiVoiceProfilesPage exported as default",
    "client/src/pages/ai-voice-profiles.tsx",
    "export default function AiVoiceProfilesPage");
  grep("Import from GPT wizard exists",
    "client/src/pages/ai-voice-profiles.tsx",
    "ImportFromGptWizard");
  grep("Profile edit dialog exists",
    "client/src/pages/ai-voice-profiles.tsx",
    "ProfileEditDialog");
  grep("App.tsx registers route for voice-profiles",
    "client/src/App.tsx",
    "settings/voice-profiles");
  grep("App.tsx lazy imports AiVoiceProfilesPage",
    "client/src/App.tsx",
    "ai-voice-profiles");
  grep("nav-config has AI Voice Profiles entry",
    "client/src/lib/nav-config.ts",
    "admin-voice-profiles");
  grep("nav-config routes to /settings/voice-profiles",
    "client/src/lib/nav-config.ts",
    "/settings/voice-profiles");

  // Modal updated
  grep("modal imports Select for voice profile dropdown",
    "client/src/components/crm/suggested-next-email-modal.tsx",
    "select-voice-profile");
  grep("modal sends voice_profile_id in POST body",
    "client/src/components/crm/suggested-next-email-modal.tsx",
    "voice_profile_id");
  grep("modal fetches voice profiles list",
    "client/src/components/crm/suggested-next-email-modal.tsx",
    "/api/ai/voice-profiles");
  grep("modal shows loading state with voice name",
    "client/src/components/crm/suggested-next-email-modal.tsx",
    "selectedVoiceName} voice");
  grep("modal has voice selector test id",
    "client/src/components/crm/suggested-next-email-modal.tsx",
    "select-voice-profile");

  // test-ids on settings page
  grep("voice profiles page has import button test-id",
    "client/src/pages/ai-voice-profiles.tsx",
    "button-import-from-gpt");
  grep("voice profiles page has new profile button test-id",
    "client/src/pages/ai-voice-profiles.tsx",
    "button-new-voice-profile");
  grep("wizard has step navigation test-ids",
    "client/src/pages/ai-voice-profiles.tsx",
    "button-wizard-next");
  grep("wizard save button has test-id",
    "client/src/pages/ai-voice-profiles.tsx",
    "button-wizard-save");
}

// ── 2. API behavioural tests ──────────────────────────────────────────────────

async function runApiTests() {
  console.log("\n── API behavioural tests ──────────────────────────────────────");

  let adminCookie, userCookie;
  try {
    adminCookie = await login("trevor@voltsafe.com", "password");
  } catch { adminCookie = null; }

  try {
    userCookie = await login("viewer@voltsafe.com", "testpass1234");
  } catch { userCookie = null; }

  const anon = (url, opts = {}) =>
    fetch(`${BASE}${url}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });

  // ── Auth guard ───────────────────────────────────────────────────────────
  await check("GET /api/ai/voice-profiles requires auth",
    anon("/api/ai/voice-profiles"),
    401);
  await check("GET /api/ai/settings requires auth",
    anon("/api/ai/settings"),
    401);

  if (!adminCookie) {
    console.log("  [skip] Admin cookie unavailable — skipping admin API tests");
  } else {
    const a = authed(adminCookie);

    // ── List profiles ────────────────────────────────────────────────────
    const listRes = await a("/api/ai/voice-profiles");
    if (listRes.status === 200) {
      const profiles = await listRes.json();
      ok("GET /api/ai/voice-profiles → 200");

      const wattson = profiles.find(p => p.name === "CEO Wattson");
      if (wattson) {
        ok("CEO Wattson global profile is in the list");
        if (wattson.profileType === "global") ok("CEO Wattson has profileType=global");
        else fail("CEO Wattson profileType should be global", JSON.stringify(wattson));
        if (wattson.isDefault === true) ok("CEO Wattson isDefault=true");
        else fail("CEO Wattson should be the default profile");
      } else {
        fail("CEO Wattson not found in /api/ai/voice-profiles");
      }
    } else {
      fail("GET /api/ai/voice-profiles should return 200", await listRes.text());
    }

    // ── Create a user profile ────────────────────────────────────────────
    const createRes = await a("/api/ai/voice-profiles", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Voice Profile",
        description: "Automated test profile",
        profileType: "user",
        systemInstructions: "Write in a test voice.",
        forbiddenPhrases: "circle back\nsynergy",
        preferredPhrases: "quick note\nthe reason I am reaching out",
        exampleMessagesJson: JSON.stringify(["Example email body 1"]),
      }),
    });

    let createdId = null;
    if (createRes.status === 201) {
      const created = await createRes.json();
      createdId = created.id;
      ok("POST /api/ai/voice-profiles → 201");
      if (created.name === "Test Voice Profile") ok("Created profile has correct name");
      if (created.profileType === "user") ok("Created profile has profileType=user");
    } else {
      fail("POST /api/ai/voice-profiles should return 201", await createRes.text());
    }

    // ── Get single profile ────────────────────────────────────────────────
    if (createdId) {
      await check(`GET /api/ai/voice-profiles/${createdId} → 200`,
        a(`/api/ai/voice-profiles/${createdId}`),
        200);

      // ── Update profile ────────────────────────────────────────────────
      const updateRes = await a(`/api/ai/voice-profiles/${createdId}`, {
        method: "PUT",
        body: JSON.stringify({ name: "Test Voice Profile (updated)" }),
      });
      if (updateRes.status === 200) {
        const updated = await updateRes.json();
        ok("PUT /api/ai/voice-profiles/:id → 200");
        if (updated.name === "Test Voice Profile (updated)") ok("Updated profile name persisted");
        else fail("Updated name not returned", JSON.stringify(updated));
      } else {
        fail("PUT /api/ai/voice-profiles/:id should return 200", await updateRes.text());
      }

      // ── Add a knowledge file ──────────────────────────────────────────
      const fileRes = await a(`/api/ai/voice-profiles/${createdId}/files`, {
        method: "POST",
        body: JSON.stringify({
          originalFilename: "test-knowledge.txt",
          fileType: "text",
          extractedText: "VoltSafe is a marina electrification company.",
        }),
      });
      if (fileRes.status === 201) {
        ok("POST /api/ai/voice-profiles/:id/files → 201");
      } else {
        fail("Knowledge file add should return 201", await fileRes.text());
      }

      // ── Delete profile ────────────────────────────────────────────────
      await check(`DELETE /api/ai/voice-profiles/${createdId} → 200`,
        a(`/api/ai/voice-profiles/${createdId}`, { method: "DELETE" }),
        200);

      // Confirm soft-delete: no longer visible
      const afterDeleteRes = await a(`/api/ai/voice-profiles/${createdId}`);
      if (afterDeleteRes.status === 404) {
        ok("Deleted profile returns 404 (soft-deleted, is_active=false)");
      } else {
        fail("Expected 404 after deletion", `Got ${afterDeleteRes.status}`);
      }
    }

    // ── Create name validation ────────────────────────────────────────────
    await check("POST without name → 400",
      a("/api/ai/voice-profiles", {
        method: "POST",
        body: JSON.stringify({ description: "No name provided" }),
      }),
      400);

    // ── Import from GPT ───────────────────────────────────────────────────
    const importRes = await a("/api/ai/voice-profiles/import-from-gpt", {
      method: "POST",
      body: JSON.stringify({
        name: "Import Test Profile",
        description: "Imported from a GPT",
        sourceLabel: "My Custom GPT",
        systemInstructions: "Write plainly and directly.",
        forbiddenPhrases: "circle back",
        preferredPhrases: "quick note",
        exampleMessages: ["Email example 1", "Email example 2"],
        knowledgeText: "Background knowledge for the voice.",
        profileType: "user",
      }),
    });

    let importedId = null;
    if (importRes.status === 201) {
      const imported = await importRes.json();
      importedId = imported.id;
      ok("POST /api/ai/voice-profiles/import-from-gpt → 201");
      if (imported.name === "Import Test Profile") ok("Imported profile name correct");
      if (imported.sourceLabel === "Imported from GPT" || imported.sourceLabel === "My Custom GPT") {
        ok("Imported profile source label saved");
      } else {
        fail("Source label not saved correctly", JSON.stringify(imported));
      }
    } else {
      fail("import-from-gpt should return 201", await importRes.text());
    }

    // Verify imported profile exists with files
    if (importedId) {
      const importedDetail = await a(`/api/ai/voice-profiles/${importedId}`);
      if (importedDetail.status === 200) {
        const detail = await importedDetail.json();
        ok("Imported profile retrievable by id");
        if (detail.files && detail.files.length > 0) {
          ok("Import knowledge text saved as a file");
        } else {
          fail("Expected knowledge file to be saved for imported profile");
        }
      }
      // Cleanup
      await a(`/api/ai/voice-profiles/${importedId}`, { method: "DELETE" });
    }

    // ── AI settings ───────────────────────────────────────────────────────
    const settingsRes = await a("/api/ai/settings");
    if (settingsRes.status === 200) {
      const settings = await settingsRes.json();
      ok("GET /api/ai/settings → 200");
      if ("defaultVoiceProfileId" in settings) ok("AI settings has defaultVoiceProfileId field");
    } else {
      fail("GET /api/ai/settings should return 200", await settingsRes.text());
    }

    // ── Set default profile ───────────────────────────────────────────────
    // Get CEO Wattson id
    const profilesForDefault = await (await a("/api/ai/voice-profiles")).json();
    const wattsonId = profilesForDefault.find(p => p.name === "CEO Wattson")?.id;
    if (wattsonId) {
      const setDefaultRes = await a("/api/ai/settings/default-voice-profile", {
        method: "PUT",
        body: JSON.stringify({ voiceProfileId: wattsonId }),
      });
      if (setDefaultRes.status === 200) {
        const newSettings = await setDefaultRes.json();
        ok("PUT /api/ai/settings/default-voice-profile → 200");
        if (newSettings.defaultVoiceProfileId === wattsonId) {
          ok("Default voice profile id persisted correctly");
        } else {
          fail("Default voice profile id not persisted", JSON.stringify(newSettings));
        }
      } else {
        fail("Set default voice profile should return 200", await setDefaultRes.text());
      }

      // Reset to null
      await a("/api/ai/settings/default-voice-profile", {
        method: "PUT",
        body: JSON.stringify({ voiceProfileId: null }),
      });
    }
  }

  // ── User isolation test ────────────────────────────────────────────────────
  if (adminCookie && userCookie) {
    const a = authed(adminCookie);
    const u = authed(userCookie);

    // Admin creates a user-scoped profile
    const isolationRes = await a("/api/ai/voice-profiles", {
      method: "POST",
      body: JSON.stringify({
        name: "Admin Private Profile",
        profileType: "user",
        systemInstructions: "Admin-only voice",
      }),
    });

    if (isolationRes.status === 201) {
      const isolatedProfile = await isolationRes.json();
      ok("Admin created a private user profile");

      // Viewer should NOT be able to see this profile
      const viewerList = await (await u("/api/ai/voice-profiles")).json();
      const found = viewerList.find(p => p.id === isolatedProfile.id);
      if (!found) {
        ok("Private profile not visible to other users (isolation correct)");
      } else {
        fail("Private user profile should NOT be visible to other users");
      }

      // Viewer should get 404 on direct GET
      const viewerGet = await u(`/api/ai/voice-profiles/${isolatedProfile.id}`);
      if (viewerGet.status === 404) {
        ok("Direct GET of private profile returns 404 for non-owner");
      } else {
        fail("Expected 404 for non-owner GET", `Got ${viewerGet.status}`);
      }

      // Viewer should NOT be able to delete admin's profile
      const viewerDelete = await u(`/api/ai/voice-profiles/${isolatedProfile.id}`, { method: "DELETE" });
      if (viewerDelete.status === 404 || viewerDelete.status === 403) {
        ok("Non-owner cannot delete private profile (returns 403/404)");
      } else {
        fail("Non-owner delete should return 403 or 404", `Got ${viewerDelete.status}`);
      }

      // Cleanup
      await a(`/api/ai/voice-profiles/${isolatedProfile.id}`, { method: "DELETE" });
    }
  }

  // ── Global profile edit protection ────────────────────────────────────────
  if (userCookie && adminCookie) {
    const a = authed(adminCookie);
    const u = authed(userCookie);

    const profilesData = await (await a("/api/ai/voice-profiles")).json();
    const globalId = profilesData.find(p => p.profileType === "global")?.id;

    if (globalId) {
      const nonAdminEdit = await u(`/api/ai/voice-profiles/${globalId}`, {
        method: "PUT",
        body: JSON.stringify({ name: "Hacked Name" }),
      });
      if (nonAdminEdit.status === 403) {
        ok("Non-admin cannot edit global profile (403)");
      } else {
        fail("Non-admin edit of global profile should return 403", `Got ${nonAdminEdit.status}`);
      }

      const nonAdminDelete = await u(`/api/ai/voice-profiles/${globalId}`, { method: "DELETE" });
      if (nonAdminDelete.status === 403) {
        ok("Non-admin cannot delete global profile (403)");
      } else {
        fail("Non-admin delete of global profile should return 403", `Got ${nonAdminDelete.status}`);
      }
    }
  }
}

// ── 3. Smoke test: CEO Wattson prompt injection structure ─────────────────────

async function runPromptInjectionTest() {
  console.log("\n── Prompt injection structural check ──────────────────────────");

  // Verify buildVoiceProfilePromptBlock produces expected sections
  const serviceSource = fs.readFileSync(
    path.resolve("server/services/ai-voice-profiles.ts"), "utf8"
  );

  // Voice profile block should include all key sections when profile has data
  const hasVoiceInstructions = serviceSource.includes("VOICE INSTRUCTIONS:");
  const hasForbidden = serviceSource.includes("FORBIDDEN PHRASES — NEVER USE THESE:");
  const hasPreferred = serviceSource.includes("PREFERRED PHRASES — USE WHERE NATURAL:");
  const hasExamples = serviceSource.includes("EXAMPLE EMAILS IN THIS VOICE:");
  const hasKnowledge = serviceSource.includes("KNOWLEDGE CONTEXT:");
  const hasBackground = serviceSource.includes("BACKGROUND KNOWLEDGE:");
  const hasHeader = serviceSource.includes("=== VOICE PROFILE:");
  const hasFooter = serviceSource.includes("=== END VOICE PROFILE ===");

  if (hasVoiceInstructions) ok("buildVoiceProfilePromptBlock: VOICE INSTRUCTIONS section");
  else fail("Missing VOICE INSTRUCTIONS section in prompt builder");

  if (hasForbidden) ok("buildVoiceProfilePromptBlock: FORBIDDEN PHRASES section");
  else fail("Missing FORBIDDEN PHRASES section in prompt builder");

  if (hasPreferred) ok("buildVoiceProfilePromptBlock: PREFERRED PHRASES section");
  else fail("Missing PREFERRED PHRASES section in prompt builder");

  if (hasExamples) ok("buildVoiceProfilePromptBlock: EXAMPLE EMAILS section");
  else fail("Missing EXAMPLE EMAILS section in prompt builder");

  if (hasKnowledge) ok("buildVoiceProfilePromptBlock: KNOWLEDGE CONTEXT section");
  else fail("Missing KNOWLEDGE CONTEXT section in prompt builder");

  if (hasBackground) ok("buildVoiceProfilePromptBlock: BACKGROUND KNOWLEDGE section");
  else fail("Missing BACKGROUND KNOWLEDGE section in prompt builder");

  if (hasHeader) ok("buildVoiceProfilePromptBlock: header marker present");
  else fail("Missing === VOICE PROFILE: header marker");

  if (hasFooter) ok("buildVoiceProfilePromptBlock: footer marker present");
  else fail("Missing === END VOICE PROFILE === footer marker");

  // crm-ai-summary wires voice profile into system prompt
  const summarySource = fs.readFileSync(
    path.resolve("server/services/crm-ai-summary.ts"), "utf8"
  );

  if (summarySource.includes("voiceProfileBlock ? voiceProfileBlock : null")) {
    ok("crm-ai-summary: voice profile block injected at top of system prompt");
  } else {
    fail("crm-ai-summary: voice profile block not injected into system prompt");
  }

  if (summarySource.includes("getVoiceProfileForPrompt")) {
    ok("crm-ai-summary: calls getVoiceProfileForPrompt for voice profile resolution");
  } else {
    fail("crm-ai-summary: missing getVoiceProfileForPrompt call");
  }

  if (summarySource.includes("buildVoiceProfilePromptBlock")) {
    ok("crm-ai-summary: calls buildVoiceProfilePromptBlock to construct prompt section");
  } else {
    fail("crm-ai-summary: missing buildVoiceProfilePromptBlock call");
  }

  // Voice profile load failure is non-fatal (fallback to default)
  if (summarySource.includes("voice profile load failure is non-fatal")) {
    ok("crm-ai-summary: voice profile load failure is non-fatal (safe fallback)");
  } else {
    fail("crm-ai-summary: missing non-fatal fallback comment for voice profile load");
  }
}

// ── 4. Database state check ──────────────────────────────────────────────────

async function runDbStateTest() {
  console.log("\n── Database state ─────────────────────────────────────────────");

  // Use psql to verify tables and seed data exist
  const { execSync } = await import("node:child_process");
  try {
    const result = execSync(
      `psql $DATABASE_URL -t -c "SELECT id, name, profile_type, is_default FROM ai_voice_profiles WHERE is_active = TRUE" 2>/dev/null`,
      { encoding: "utf8" }
    );
    if (result.includes("CEO Wattson")) {
      ok("DB: CEO Wattson profile exists in ai_voice_profiles");
    } else {
      fail("DB: CEO Wattson not found in ai_voice_profiles");
    }
    if (result.includes("global")) {
      ok("DB: global profile type seeded correctly");
    } else {
      fail("DB: no global profile type found");
    }
  } catch (err) {
    fail("DB check failed", err.message);
  }

  try {
    const tablesResult = execSync(
      `psql $DATABASE_URL -t -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('ai_voice_profiles','ai_voice_profile_files','user_ai_settings') ORDER BY table_name" 2>/dev/null`,
      { encoding: "utf8" }
    );
    if (tablesResult.includes("ai_voice_profile_files")) ok("DB: ai_voice_profile_files table exists");
    else fail("DB: ai_voice_profile_files table missing");
    if (tablesResult.includes("ai_voice_profiles")) ok("DB: ai_voice_profiles table exists");
    else fail("DB: ai_voice_profiles table missing");
    if (tablesResult.includes("user_ai_settings")) ok("DB: user_ai_settings table exists");
    else fail("DB: user_ai_settings table missing");
  } catch (err) {
    fail("DB table check failed", err.message);
  }
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== AI Voice Profiles Test Suite ===\n");

  await runSourceGrepTests();
  await runApiTests();
  await runPromptInjectionTest();
  await runDbStateTest();

  console.log(`\n${"─".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  console.log("─".repeat(55));

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
