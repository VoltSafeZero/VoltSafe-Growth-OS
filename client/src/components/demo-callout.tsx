import { useState, useEffect } from "react";
import { isDemoModeActive } from "@/lib/demo-mode";

/**
 * DemoCalloutOverlay — visual training cues for onboarding recordings.
 *
 * Listens for two custom DOM events dispatched by the Playwright scripts:
 *   voltSafeCallout   → shows a bottom-centre callout bubble
 *   voltSafeStepTitle → flashes a full-screen section title for 2.8 s
 *
 * Only renders when demo mode is active. Has no effect in production.
 */
export function DemoCalloutOverlay() {
  const [callout, setCallout]       = useState("");
  const [calloutOn, setCalloutOn]   = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");

  useEffect(() => {
    if (!isDemoModeActive()) return;

    const handleCallout = (e: Event) => {
      const { text, visible } = (e as CustomEvent).detail;
      if (visible) {
        setCallout(text);
        setCalloutOn(true);
      } else {
        setCalloutOn(false);
        setTimeout(() => setCallout(""), 350);
      }
    };

    const handleStepTitle = (e: Event) => {
      const { title } = (e as CustomEvent).detail;
      setSectionTitle(title);
      setTimeout(() => setSectionTitle(""), 2600);
    };

    window.addEventListener("voltSafeCallout",  handleCallout);
    window.addEventListener("voltSafeStepTitle", handleStepTitle);
    return () => {
      window.removeEventListener("voltSafeCallout",  handleCallout);
      window.removeEventListener("voltSafeStepTitle", handleStepTitle);
    };
  }, []);

  if (!isDemoModeActive()) return null;

  return (
    <>
      {sectionTitle && (
        <div
          data-testid="demo-step-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8, 47, 73, 0.72)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #0e7490 0%, #0369a1 100%)",
              color: "#fff",
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "0.02em",
              padding: "22px 48px",
              borderRadius: "14px",
              boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              textAlign: "center",
              maxWidth: "700px",
            }}
          >
            {sectionTitle}
          </div>
        </div>
      )}

      {callout && (
        <div
          data-testid="demo-callout"
          style={{
            position: "fixed",
            bottom: "36px",
            left: "50%",
            transform: `translateX(-50%)`,
            zIndex: 9997,
            background: calloutOn ? "rgba(14, 116, 144, 0.93)" : "rgba(14, 116, 144, 0)",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            padding: "10px 28px",
            borderRadius: "24px",
            boxShadow: calloutOn ? "0 6px 24px rgba(0,0,0,0.35)" : "none",
            maxWidth: "620px",
            textAlign: "center",
            pointerEvents: "none",
            transition: "background 0.3s ease, box-shadow 0.3s ease",
            whiteSpace: "nowrap",
          }}
        >
          ◎ &nbsp;{callout}
        </div>
      )}
    </>
  );
}
