/**
 * CurrentsWaterflowBackdrop
 *
 * Pure-CSS animated dark-marine backdrop for the CURRENTS workspace.
 *
 * Animation behaviour:
 *   • Plays once on mount (~5-6 s of flowing motion).
 *   • animation-iteration-count: 1 + animation-fill-mode: forwards keeps
 *     the final frame visible so the workspace retains its marine vibe while
 *     adding zero ongoing CPU cost.
 *   • prefers-reduced-motion: all animation disabled; static gradient only.
 *   • No canvas, no JS loops, no timers that need cleanup.
 *
 * Stacking:
 *   • Positioned absolute inset-0 z-0.
 *   • The shell's content layer is z-[1] so chat panels render on top.
 */

export function CurrentsWaterflowBackdrop() {
  return (
    <>
      <style>{`
        @keyframes vs-wave-a {
          0%   { transform: translateX(-5%) translateY(4px) scaleY(1.06); opacity: 0; }
          18%  { opacity: 1; }
          55%  { transform: translateX(3%)  translateY(-8px) scaleY(0.96); }
          88%  { opacity: 0.9; }
          100% { transform: translateX(0%)  translateY(0px)  scaleY(1);    opacity: 0.22; }
        }
        @keyframes vs-wave-b {
          0%   { transform: translateX(4%)  translateY(-6px) scaleY(0.95); opacity: 0; }
          22%  { opacity: 0.85; }
          58%  { transform: translateX(-3%) translateY(6px)  scaleY(1.04); }
          90%  { opacity: 0.75; }
          100% { transform: translateX(0%)  translateY(0px)  scaleY(1);    opacity: 0.15; }
        }
        @keyframes vs-wave-c {
          0%   { transform: translateY(10px) scaleX(1.05); opacity: 0; }
          25%  { opacity: 0.6; }
          60%  { transform: translateY(-5px) scaleX(0.97); }
          88%  { opacity: 0.5; }
          100% { transform: translateY(0px)  scaleX(1);    opacity: 0.1;  }
        }
        @keyframes vs-radial-bloom {
          0%   { opacity: 0;    transform: scale(0.82); }
          35%  { opacity: 0.95; }
          100% { opacity: 0.38; transform: scale(1);    }
        }
        @keyframes vs-shimmer-scan {
          0%   { transform: translateX(-110%) skewX(-14deg); opacity: 0;    }
          8%   { opacity: 0.55; }
          88%  { opacity: 0.45; }
          100% { transform: translateX(210%)  skewX(-14deg); opacity: 0;    }
        }
        @keyframes vs-grid-fadein {
          0%   { opacity: 0;     }
          100% { opacity: 0.028; }
        }

        @media (prefers-reduced-motion: reduce) {
          .vs-wave-a, .vs-wave-b, .vs-wave-c,
          .vs-radial, .vs-shimmer, .vs-grid {
            animation: none !important;
          }
          .vs-wave-a { opacity: 0.18 !important; }
          .vs-wave-b { opacity: 0.12 !important; }
          .vs-wave-c { opacity: 0.08 !important; }
          .vs-radial  { opacity: 0.32 !important; transform: scale(1) !important; }
          .vs-grid    { opacity: 0.025 !important; }
          .vs-shimmer { opacity: 0 !important; }
        }
      `}</style>

      {/* ── Base marine gradient ────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        role="presentation"
        data-testid="currents-waterflow-backdrop"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
        style={{
          background:
            "linear-gradient(160deg, #050c1a 0%, #091526 30%, #060e1c 58%, #040b14 100%)",
        }}
      >
        {/* Wave band A — primary cyan swell */}
        <div
          className="vs-wave-a absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 190% 45% at 28% 58%, rgba(6,182,212,0.085) 0%, rgba(8,145,178,0.04) 45%, transparent 70%)",
            animation:
              "vs-wave-a 5.6s cubic-bezier(0.4,0,0.2,1) 0s 1 forwards",
          }}
        />

        {/* Wave band B — teal counter-swell */}
        <div
          className="vs-wave-b absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 155% 35% at 72% 42%, rgba(20,184,166,0.07) 0%, rgba(6,182,212,0.03) 40%, transparent 68%)",
            animation:
              "vs-wave-b 6.4s cubic-bezier(0.4,0,0.2,1) 0.35s 1 forwards",
          }}
        />

        {/* Wave band C — deep horizontal current streak */}
        <div
          className="vs-wave-c absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 22%, rgba(6,182,212,0.05) 42%, rgba(8,145,178,0.055) 58%, transparent 78%)",
            animation:
              "vs-wave-c 7.2s cubic-bezier(0.4,0,0.2,1) 0.7s 1 forwards",
          }}
        />

        {/* Radial glow — blooms behind the workspace panel, then settles */}
        <div
          className="vs-radial absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 52% 52% at 60% 50%, rgba(6,182,212,0.095) 0%, rgba(8,145,178,0.045) 38%, transparent 68%)",
            animation:
              "vs-radial-bloom 5.2s cubic-bezier(0.4,0,0.6,1) 0.15s 1 forwards",
          }}
        />

        {/* Shimmer scan-line — single horizontal sweep */}
        <div
          className="vs-shimmer absolute inset-y-0 left-0 right-0"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.09) 50%, transparent 100%)",
            animation:
              "vs-shimmer-scan 3.8s linear 0.4s 1 forwards",
          }}
        />

        {/* Subtle digital grid — fades in and stays static */}
        <div
          className="vs-grid absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(6,182,212,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.35) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            opacity: 0,
            animation: "vs-grid-fadein 4s ease-out 1s 1 forwards",
          }}
        />

        {/* Corner vignettes — static depth */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(2,6,14,0.45) 0%, transparent 55%), radial-gradient(ellipse 80% 80% at 100% 100%, rgba(2,6,14,0.35) 0%, transparent 50%)",
          }}
        />
      </div>
    </>
  );
}
