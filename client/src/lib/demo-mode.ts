/**
 * Demo Mode — activated by ?demo=1 URL param or localStorage flag.
 * When active: shows a visible banner, blocks real email sends,
 * and keeps all normal UI layout intact for clean recordings.
 */

import React from "react";

const DEMO_KEY = "voltSafeDemoMode";

export function isDemoModeActive(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("demo") === "1") {
    try { localStorage.setItem(DEMO_KEY, "1"); } catch {}
    return true;
  }
  try { return localStorage.getItem(DEMO_KEY) === "1"; } catch {}
  return false;
}

export function clearDemoMode(): void {
  try { localStorage.removeItem(DEMO_KEY); } catch {}
}

export function DemoModeBanner(): React.ReactElement | null {
  if (!isDemoModeActive()) return null;
  return React.createElement(
    "div",
    {
      "data-testid": "demo-mode-banner",
      style: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "linear-gradient(90deg, #0e7490 0%, #0891b2 100%)",
        color: "#fff",
        fontSize: "12px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textAlign: "center",
        padding: "5px 12px",
        pointerEvents: "none",
        userSelect: "none",
      },
    },
    "\u25CF DEMO MODE \u2014 No real emails will be sent \u00B7 No data will be modified"
  );
}
