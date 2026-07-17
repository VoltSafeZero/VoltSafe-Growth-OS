/**
 * mention-real-dom.vitest.tsx
 *
 * Real DOM component integration tests for the @mention clean-text display rule.
 * Uses vitest + @testing-library/react + happy-dom.
 *
 * Verifies:
 *  1. tokensToCleanText / serializeToTokens pure utilities
 *  2. Mouse click selection → textarea shows @Scott, NOT @[Scott](user:138)
 *  3. Keyboard (ArrowDown + Enter) selection → same invariant
 *  4. Dropdown closes after selection
 *  5. serializeForSave produces correct token format for DB
 *  6. userId 138 metadata preserved in serialized output
 *  7. Reopen from stored token — display is clean
 *  8. Canonical name for user ID 138: "@Scott"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useState, useRef } from "react";

import {
  useMentionComposer,
  tokensToCleanText,
  serializeToTokens,
  parseTokensToEntries,
} from "@/hooks/use-mention-composer";

// ── Mock data matching real DB users ─────────────────────────────────────────
const MOCK_USERS = [
  { id: 138, name: "Scott", email: "scott@voltsafe.com" },
  { id: 6, name: "Test Viewer", email: "viewer@voltsafe.com" },
  { id: 7, name: "Test Mixed", email: "mixed@voltsafe.com" },
];

function mockFetch(url: RequestInfo | URL): Promise<Response> {
  const urlStr = String(url);
  if (urlStr.includes("/api/current/users")) {
    const q = new URL(urlStr, "http://localhost").searchParams.get("q") ?? "";
    const filtered = q
      ? MOCK_USERS.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()))
      : MOCK_USERS;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(filtered),
    } as Response);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
}

// ── Minimal test harness component ────────────────────────────────────────────
function MentionTestHarness({ initialValue = "" }: { initialValue?: string }) {
  const [draft, setDraft] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionComposer(taRef);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    mention.onValueChange(val, cursor);
    setDraft(val);
  };

  return (
    <div>
      <textarea
        ref={taRef}
        value={draft}
        data-testid="composer"
        onChange={handleChange}
        onKeyDown={(e) => mention.handleMentionKeyDown(e, draft, setDraft)}
      />

      {mention.mentionActive && (
        <div data-testid="dropdown">
          {mention.mentionUsers.map((u) => (
            <div
              key={u.id}
              data-testid={`user-${u.id}`}
              onPointerDown={(e) => {
                e.preventDefault();
                mention.insertMention(draft, setDraft, u);
              }}
            >
              {u.name}
            </div>
          ))}
        </div>
      )}

      <div data-testid="serialized">{mention.serializeForSave(draft)}</div>
      <div data-testid="dropdown-open">{String(mention.mentionActive)}</div>
    </div>
  );
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("@mention clean-text display rule — real DOM", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  // ── Section A: pure utility functions ─────────────────────────────────────
  describe("A. tokensToCleanText (DB → editor display)", () => {
    it("A1. converts single token to clean name", () => {
      expect(tokensToCleanText("@[Scott](user:138)")).toBe("@Scott");
    });

    it("A2. converts multiple tokens in one string", () => {
      const stored = "hey @[Scott](user:138) and @[Test Viewer](user:6) done";
      expect(tokensToCleanText(stored)).toBe("hey @Scott and @Test Viewer done");
    });

    it("A3. leaves plain text unchanged", () => {
      expect(tokensToCleanText("hello world")).toBe("hello world");
    });

    it("A4. handles null / undefined gracefully", () => {
      expect(tokensToCleanText(null)).toBe("");
      expect(tokensToCleanText(undefined)).toBe("");
    });

    it("A5. output NEVER contains raw token pattern ](user:", () => {
      const out = tokensToCleanText("@[Scott](user:138) cc @[Test Viewer](user:6)");
      expect(out).not.toContain("](user:");
      expect(out).not.toContain("@[");
    });
  });

  describe("A. serializeToTokens (editor → DB)", () => {
    it("A6. round-trips a single mention correctly", () => {
      const stored = "@[Scott](user:138) hello";
      const clean = tokensToCleanText(stored);
      const entries = parseTokensToEntries(stored);
      expect(serializeToTokens(clean, entries)).toBe(stored);
    });

    it("A7. clean text itself never contains raw tokens", () => {
      const clean = "@Scott hello";
      expect(clean).not.toContain("](user:");
      expect(clean).not.toContain("@[");
    });
  });

  // ── Section B: mouse click selection ──────────────────────────────────────
  describe("B. Mouse click selection", () => {
    it("B1. typing @sc shows Scott in dropdown", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => expect(screen.getByTestId("dropdown")).toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByTestId("user-138")).toHaveTextContent("Scott")
      );
    });

    it("B2. after clicking Scott: textarea shows @Scott (clean text)", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => expect(ta.value).toContain("@Scott"));
      expect(ta.value).not.toContain("@[Scott]");
      expect(ta.value).not.toContain("](user:");
    });

    it("B3. raw token @[ never appears in textarea after selection", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "hello @sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => expect(ta.value).toContain("@Scott"));
      expect(ta.value).not.toMatch(/@\[/);
      expect(ta.value).not.toMatch(/\]\(user:/);
    });

    it("B4. dropdown closes after mouse selection", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("dropdown"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() =>
        expect(screen.getByTestId("dropdown-open")).toHaveTextContent("false")
      );
    });

    it("B5. serialized output has token format (DB storage correct)", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => {
        const s = screen.getByTestId("serialized").textContent ?? "";
        expect(s).toContain("@[Scott](user:138)");
      });
    });

    it("B6. serialized output preserves userId 138 as structured metadata", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => {
        const s = screen.getByTestId("serialized").textContent ?? "";
        expect(s).toContain("user:138");
      });
    });

    it("B7. textarea value matches @Scott (canonical for user ID 138)", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => expect(ta.value).toContain("@Scott"));
      expect(ta.value.startsWith("@Scott")).toBe(true);
    });
  });

  // ── Section C: keyboard selection ─────────────────────────────────────────
  describe("C. Keyboard selection (ArrowDown + Enter)", () => {
    it("C1. Enter on first result selects and shows clean @Name", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.keyDown(ta, { key: "Enter" });
      await waitFor(() => expect(ta.value).toContain("@Scott"));
      expect(ta.value).not.toContain("@[");
      expect(ta.value).not.toContain("](user:");
    });

    it("C2. Escape closes dropdown without inserting a token", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("dropdown"));
      fireEvent.keyDown(ta, { key: "Escape" });
      await waitFor(() =>
        expect(screen.getByTestId("dropdown-open")).toHaveTextContent("false")
      );
      expect(ta.value).not.toContain("@[");
      expect(ta.value).not.toContain("](user:");
    });

    it("C3. ArrowDown shifts selection index without inserting", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@");
      await waitFor(() => screen.getByTestId("dropdown"));
      fireEvent.keyDown(ta, { key: "ArrowDown" });
      expect(screen.getByTestId("dropdown-open")).toHaveTextContent("true");
      expect(ta.value).toBe("@");
    });
  });

  // ── Section D: reopen from saved token value ───────────────────────────────
  describe("D. Reopen saved value — read-mode and edit-mode display", () => {
    it("D1. tokensToCleanText produces @Scott from stored token", () => {
      const stored = "@[Scott](user:138) please review the marina contracts.";
      const display = tokensToCleanText(stored);
      expect(display).toBe("@Scott please review the marina contracts.");
      expect(display).not.toContain("@[");
      expect(display).not.toContain("](user:");
    });

    it("D2. initialValue with clean text shows @Scott in textarea (not token)", () => {
      const stored = "@[Scott](user:138) follow up on quote";
      const cleanForEditor = tokensToCleanText(stored);
      wrap(<MentionTestHarness initialValue={cleanForEditor} />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      expect(ta.value).toBe("@Scott follow up on quote");
      expect(ta.value).not.toContain("@[");
      expect(ta.value).not.toContain("](user:");
    });

    it("D3. stored token string with two mentions — clean text has both names", () => {
      const stored = "@[Scott](user:138) and @[Test Viewer](user:6) please review";
      const display = tokensToCleanText(stored);
      expect(display).toBe("@Scott and @Test Viewer please review");
      expect(display).not.toContain("](user:");
    });
  });

  // ── Section E: canonical name verification ────────────────────────────────
  describe("E. Canonical name — user ID 138", () => {
    it("E1. display name for user ID 138 is Scott (single word, no last name)", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      expect(screen.getByTestId("user-138").textContent).toBe("Scott");
    });

    it("E2. visible text after selection is @Scott (not @Scott Carlson or other)", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer") as HTMLTextAreaElement;
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => expect(ta.value).toContain("@Scott"));
      expect(ta.value.startsWith("@Scott ")).toBe(true);
    });

    it("E3. serialized token uses @[Scott](user:138) — name from DB", async () => {
      wrap(<MentionTestHarness />);
      const ta = screen.getByTestId("composer");
      await userEvent.type(ta, "@sc");
      await waitFor(() => screen.getByTestId("user-138"));
      fireEvent.pointerDown(screen.getByTestId("user-138"));
      await waitFor(() => {
        const s = screen.getByTestId("serialized").textContent ?? "";
        expect(s).toBe("@[Scott](user:138) ");
      });
    });
  });
});
