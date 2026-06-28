/**
 * CurrentsWaterflowBackdrop — Phase 5B: Photorealistic Tropical Water
 *
 * Visual approach
 * ───────────────
 * Layered CSS technique that simulates clear tropical water (Gulf / clear river):
 *
 *   1. Deep teal-emerald base gradient
 *   2. Fine caustic mesh A  — small radial dots tiled at 160×120 px, drifting
 *      diagonally (+x +y).  Seamless loop: moves exactly one tile per cycle.
 *   3. Medium caustic mesh B — larger dots at 240×180 px, drifting counter-
 *      diagonally (-x +y).  Seamless loop likewise.
 *   4. Diagonal ripple lines — repeating-linear-gradient bands animating
 *      across the surface (current movement).
 *   5. Ambient aqua glow    — soft radial bloom in the work-panel zone.
 *   6. Sunlight glint A     — slow wide horizontal band (sunlight on surface).
 *   7. Sunlight glint B     — offset timing, slightly narrower.
 *   8. Dark readability scrim — teal-navy gradient overlay ensuring contrast.
 *   9. Edge vignette         — corners darkened for depth.
 *
 * All animations are GPU-composited (`background-position`, `transform`,
 * `opacity`) — no JS loops, no canvas, no timers.
 *
 * `mix-blend-mode: screen` on caustic layers makes bright spots ADD light
 * naturally against the dark base (photorealistic light behaviour).
 *
 * Reduced motion
 * ──────────────
 * `animation-play-state: paused` freezes every animated layer in-place.
 * The static result is still a beautiful deep-water scene.
 *
 * Stacking (inside CurrentsWorkspaceShell)
 * ─────────────────────────────────────────
 *   z-0  → this backdrop (absolute inset-0)
 *   z-[1]→ CurrentsWorkspaceShell content layer (chat UI)
 */

export function CurrentsWaterflowBackdrop() {
  return (
    <>
      <style>{`
        /* ── Caustic mesh — seamless tile loops ─────────────────────────── */

        @keyframes vs-caustic-a {
          /* Tile is 160×120 px. Move exactly one tile → seamless. */
          0%   { background-position: 0px 0px; }
          100% { background-position: 160px 120px; }
        }

        @keyframes vs-caustic-b {
          /* Tile is 240×180 px. Move neg-x pos-y for counter-drift. */
          0%   { background-position: 0px 0px; }
          100% { background-position: -240px 180px; }
        }

        /* ── Diagonal ripple current lines ──────────────────────────────── */

        @keyframes vs-ripple {
          0%   { background-position: 0px 0px; }
          100% { background-position: 120px -80px; }
        }

        /* ── Sunlight glints — slow sweeping passes ─────────────────────── */

        @keyframes vs-glint-a {
          0%        { transform: translateX(-90%) skewX(-10deg); opacity: 0;    }
          8%        { opacity: 0.55; }
          20%       { opacity: 0.35; }
          28%       { opacity: 0;    transform: translateX(130%) skewX(-10deg); }
          100%      { transform: translateX(130%) skewX(-10deg); opacity: 0;    }
        }

        @keyframes vs-glint-b {
          0%, 55%   { opacity: 0; transform: translateX(-90%) skewX(-7deg); }
          62%       { opacity: 0; }
          70%       { opacity: 0.40; }
          80%       { opacity: 0.22; }
          88%       { opacity: 0;    transform: translateX(130%) skewX(-7deg); }
          100%      { opacity: 0;    transform: translateX(130%) skewX(-7deg); }
        }

        /* ── Reduced-motion: freeze everything in place ─────────────────── */

        @media (prefers-reduced-motion: reduce) {
          .vs-caustic-a,
          .vs-caustic-b,
          .vs-ripple-layer,
          .vs-glint-a,
          .vs-glint-b {
            animation-play-state: paused !important;
          }
        }
      `}</style>

      <div
        aria-hidden="true"
        role="presentation"
        data-testid="currents-waterflow-backdrop"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
      >

        {/* ── 1. Base: deep tropical water gradient ──────────────────────── */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(175deg, #071e30 0%, #0a3040 18%, #0b4038 38%, #094038 55%, #073530 72%, #051820 90%, #03101a 100%)",
          }}
        />

        {/* ── 2. Caustic mesh A — fine, drifting diagonally ─────────────── */}
        {/*    Small tiled radial dots simulate refracted sunlight on water.  */}
        {/*    mix-blend-mode: screen — bright dots ADD light naturally.       */}
        <div
          className="vs-caustic-a absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(ellipse 4px 3px at 18% 28%, rgba(0,230,185,0.24) 0%, transparent 100%)",
              "radial-gradient(ellipse 3px 5px at 52% 15%, rgba(20,218,178,0.20) 0%, transparent 100%)",
              "radial-gradient(ellipse 5px 3px at 78% 58%, rgba(0,205,172,0.22) 0%, transparent 100%)",
              "radial-gradient(ellipse 3px 4px at 35% 72%, rgba(30,222,182,0.18) 0%, transparent 100%)",
              "radial-gradient(ellipse 6px 3px at 88% 25%, rgba(0,215,178,0.21) 0%, transparent 100%)",
              "radial-gradient(ellipse 3px 3px at 62% 85%, rgba(15,228,188,0.16) 0%, transparent 100%)",
              "radial-gradient(ellipse 4px 5px at 8%  55%, rgba(0,222,182,0.19) 0%, transparent 100%)",
              "radial-gradient(ellipse 2px 4px at 42% 42%, rgba(40,230,190,0.15) 0%, transparent 100%)",
            ].join(", "),
            backgroundSize: "160px 120px",
            animation: "vs-caustic-a 22s linear infinite",
            mixBlendMode: "screen",
            opacity: 0.9,
          }}
        />

        {/* ── 3. Caustic mesh B — larger, counter-drifting ──────────────── */}
        <div
          className="vs-caustic-b absolute inset-0"
          style={{
            backgroundImage: [
              "radial-gradient(ellipse 8px 5px at 22% 42%, rgba(0,200,168,0.13) 0%, transparent 100%)",
              "radial-gradient(ellipse 6px 9px at 68% 18%, rgba(0,218,178,0.11) 0%, transparent 100%)",
              "radial-gradient(ellipse 7px 5px at 45% 68%, rgba(20,208,170,0.12) 0%, transparent 100%)",
              "radial-gradient(ellipse 10px 6px at 82% 55%, rgba(0,222,180,0.14) 0%, transparent 100%)",
              "radial-gradient(ellipse 5px 10px at 12% 80%, rgba(10,212,174,0.10) 0%, transparent 100%)",
              "radial-gradient(ellipse 8px 5px at 58% 38%, rgba(5,205,170,0.09) 0%, transparent 100%)",
            ].join(", "),
            backgroundSize: "240px 180px",
            animation: "vs-caustic-b 34s linear infinite",
            mixBlendMode: "screen",
            opacity: 0.75,
          }}
        />

        {/* ── 4. Diagonal ripple current lines ──────────────────────────── */}
        {/*    Fine repeating stripes moving diagonally = flowing current.   */}
        <div
          className="vs-ripple-layer absolute inset-0"
          style={{
            backgroundImage: [
              "repeating-linear-gradient(108deg, transparent 0px, transparent 24px, rgba(0,200,172,0.035) 24px, rgba(0,200,172,0.035) 26px)",
              "repeating-linear-gradient(112deg, transparent 0px, transparent 40px, rgba(20,215,182,0.025) 40px, rgba(20,215,182,0.025) 42px)",
              "repeating-linear-gradient(105deg, transparent 0px, transparent 16px, rgba(0,210,178,0.02) 16px, rgba(0,210,178,0.02) 17px)",
            ].join(", "),
            animation: "vs-ripple 28s linear infinite",
            opacity: 0.85,
          }}
        />

        {/* ── 5. Ambient aqua glow — mid-depth light bloom ─────────────── */}
        {/*    Static. Gives a 3-D sense of water depth below the surface.  */}
        <div
          className="absolute inset-0"
          style={{
            background: [
              "radial-gradient(ellipse 72% 56% at 58% 44%, rgba(0,125,112,0.16) 0%, transparent 65%)",
              "radial-gradient(ellipse 42% 32% at 18% 72%, rgba(0,105,92,0.09) 0%, transparent 58%)",
              "radial-gradient(ellipse 35% 28% at 85% 20%, rgba(0,118,105,0.08) 0%, transparent 55%)",
            ].join(", "),
          }}
        />

        {/* ── 6. Sunlight glint A — slow wide sweep ─────────────────────── */}
        {/*    Simulates a ray of sunlight passing across the water surface. */}
        <div
          className="vs-glint-a absolute inset-y-0"
          style={{
            left: 0,
            right: 0,
            background:
              "linear-gradient(90deg, transparent 5%, rgba(80,248,212,0.10) 38%, rgba(112,255,222,0.20) 50%, rgba(80,248,212,0.10) 62%, transparent 95%)",
            animation: "vs-glint-a 18s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />

        {/* ── 7. Sunlight glint B — offset timing, narrower ─────────────── */}
        <div
          className="vs-glint-b absolute inset-y-0"
          style={{
            left: 0,
            right: 0,
            background:
              "linear-gradient(90deg, transparent 10%, rgba(60,232,198,0.07) 40%, rgba(90,242,208,0.14) 50%, rgba(60,232,198,0.07) 60%, transparent 90%)",
            animation: "vs-glint-b 24s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />

        {/* ── 8. Readability scrim — dark teal-navy overlay ─────────────── */}
        {/*    Sits above water layers. Ensures all chat content is readable. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(170deg, rgba(3,11,22,0.72) 0%, rgba(4,15,26,0.64) 30%, rgba(3,13,22,0.66) 65%, rgba(2,8,16,0.80) 100%)",
          }}
        />

        {/* ── 9. Edge vignette — depth + focus on center ────────────────── */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 88% 82% at 50% 50%, transparent 32%, rgba(1,6,14,0.62) 100%)",
          }}
        />

      </div>
    </>
  );
}
