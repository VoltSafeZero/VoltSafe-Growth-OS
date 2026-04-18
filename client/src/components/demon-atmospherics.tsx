import { useTheme } from "@/components/theme-provider";

/**
 * DemonAtmospherics
 *
 * Environmental art layer system for the Demon Dark and Demon Light themes.
 *
 * Renders fixed-position, pointer-events:none SVG layers behind the entire
 * application. Composed of three layered passes:
 *
 *   1. Roots/vines  — large organic branching strokes climbing from bottom corners
 *   2. Thorn frame  — jagged silhouettes anchored at viewport corners
 *   3. Rupture cracks — sparse cracked-glass lines reading as a tear in the surface
 *
 * Each layer's color and opacity is tuned per theme:
 *   - Demon Dark:  blood-tinted strokes with soft glow filter, screen-blendish
 *   - Demon Light: dark graphite strokes with multiply blend, lower alpha
 *
 * Mounted once at the App root, BEHIND the AppShell (via z-index 0 / fixed).
 * The AppShell's `bg-background` is overridden to transparent under demon
 * themes (see index.css) so this layer is actually visible.
 *
 * Returns null for non-demon themes so there is zero DOM cost in light/dark.
 */
export function DemonAtmospherics() {
  const { theme } = useTheme();
  const isDemonDark = theme === "demon";
  const isDemonLight = theme === "demon-light";
  if (!isDemonDark && !isDemonLight) return null;

  // Per-theme tuning — kept here so the SVG markup below stays one tree.
  // Dark variant: blood-red strokes, glow filter active, higher alpha.
  // Light variant: dark graphite strokes, no glow, lower alpha, multiply blend.
  const tuning = isDemonDark
    ? {
        vineColor: "hsl(355 75% 38%)",
        vineGlowColor: "hsl(355 90% 50%)",
        vineOpacity: 0.55,
        vineBlend: "screen" as const,
        glowEnabled: true,
        thornColor: "hsl(355 30% 4%)",
        thornRimColor: "hsl(355 70% 28%)",
        thornOpacity: 0.85,
        thornBlend: "normal" as const,
        crackColor: "hsl(355 80% 50%)",
        crackOpacity: 0.18,
        crackBlend: "screen" as const,
      }
    : {
        vineColor: "hsl(350 22% 18%)",
        vineGlowColor: "hsl(350 30% 30%)",
        vineOpacity: 0.32,
        vineBlend: "multiply" as const,
        glowEnabled: false,
        thornColor: "hsl(350 18% 30%)",
        thornRimColor: "hsl(355 35% 40%)",
        thornOpacity: 0.38,
        thornBlend: "multiply" as const,
        crackColor: "hsl(350 20% 25%)",
        crackOpacity: 0.18,
        crackBlend: "multiply" as const,
      };

  return (
    <div
      aria-hidden="true"
      data-testid="demon-atmospherics"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      // z-index 0 places this behind the AppShell content (which sits at z-10
      // via the demon-themed override in index.css). Fixed positioning so the
      // art does not scroll with content — it's the world the app lives inside.
    >
      {/* ── LAYER 1: Roots / Vines ─────────────────────────────────────────
        * Organic branching curves climbing from bottom-left and bottom-right
        * corners, with a sparse crossing trace through the upper-mid area.
        * Stroke widths taper from heavy at the root to thin at the tip.
        * In Demon Dark the SVG filter adds a soft red glow; in Demon Light
        * we skip the filter (would wash out a pale substrate). */}
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: tuning.vineOpacity,
          mixBlendMode: tuning.vineBlend,
          color: tuning.vineColor,
        }}
      >
        <defs>
          {tuning.glowEnabled && (
            <filter id="vine-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor={tuning.vineGlowColor} floodOpacity="0.55" />
              <feComposite in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        <g
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={tuning.glowEnabled ? "url(#vine-glow)" : undefined}
        >
          {/* Bottom-left primary vines — three thicknesses for parallax depth */}
          <path d="M -40 1010 C 60 870, 110 740, 175 610 S 290 380, 380 200" strokeWidth="4.5" opacity="0.78" />
          <path d="M 70 1020 C 130 880, 195 760, 280 640 S 420 420, 525 250" strokeWidth="3.2" opacity="0.62" />
          <path d="M -20 980 C 90 900, 215 800, 305 680 S 450 470, 560 320" strokeWidth="2.2" opacity="0.45" />
          {/* Bottom-left tendril branches off the primary vines */}
          <path d="M 175 610 C 230 555, 305 525, 385 520" strokeWidth="1.8" opacity="0.55" />
          <path d="M 280 640 C 330 580, 405 555, 475 540" strokeWidth="1.4" opacity="0.45" />
          <path d="M 305 680 C 360 720, 430 740, 510 735" strokeWidth="1.2" opacity="0.4" />
          <path d="M 385 520 C 420 480, 470 460, 510 470" strokeWidth="1" opacity="0.5" />

          {/* Bottom-right primary vines (mirrored, slightly different shapes for organic feel) */}
          <path d="M 1640 1010 C 1540 870, 1490 740, 1420 610 S 1300 380, 1210 200" strokeWidth="4.5" opacity="0.78" />
          <path d="M 1530 1020 C 1465 880, 1400 760, 1315 640 S 1175 420, 1070 250" strokeWidth="3.2" opacity="0.62" />
          <path d="M 1620 980 C 1510 900, 1385 800, 1295 680 S 1150 470, 1040 320" strokeWidth="2.2" opacity="0.45" />
          {/* Bottom-right tendril branches */}
          <path d="M 1420 610 C 1370 555, 1295 525, 1215 520" strokeWidth="1.8" opacity="0.55" />
          <path d="M 1315 640 C 1265 580, 1190 555, 1120 540" strokeWidth="1.4" opacity="0.45" />
          <path d="M 1295 680 C 1235 720, 1165 740, 1085 735" strokeWidth="1.2" opacity="0.4" />
          <path d="M 1215 520 C 1180 480, 1130 460, 1090 470" strokeWidth="1" opacity="0.5" />

          {/* Sparse top vines — much subtler, descend a short way */}
          <path d="M 220 -30 C 260 90, 315 180, 360 270" strokeWidth="1.4" opacity="0.32" />
          <path d="M 310 -30 C 340 110, 380 200, 410 290" strokeWidth="1" opacity="0.22" />
          <path d="M 1380 -30 C 1340 90, 1285 180, 1240 270" strokeWidth="1.4" opacity="0.32" />
          <path d="M 1290 -30 C 1260 110, 1220 200, 1190 290" strokeWidth="1" opacity="0.22" />

          {/* Center-crossing root — very faint, ties left and right systems together */}
          <path d="M 380 200 C 580 130, 850 105, 1100 140 S 1210 200, 1210 200" strokeWidth="0.9" opacity="0.18" />

          {/* Side ribs climbing up the left and right margins */}
          <path d="M -10 700 C 30 600, 80 500, 130 380" strokeWidth="1.3" opacity="0.35" />
          <path d="M 1610 700 C 1570 600, 1520 500, 1470 380" strokeWidth="1.3" opacity="0.35" />
        </g>
      </svg>

      {/* ── LAYER 2: Thorn frame ────────────────────────────────────────────
        * Jagged thorn silhouettes anchored at the four viewport corners, with
        * the bottom corners much heavier (the "breach" lives below). Subtle
        * rim lights traced along the upper edge of each thorn cluster so they
        * read as carved relief, not flat decals. */}
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: tuning.thornOpacity,
          mixBlendMode: tuning.thornBlend,
        }}
      >
        {/* Bottom-left thorn cluster — primary silhouette */}
        <path
          d="M 0 1000 L 0 870 L 22 990 L 50 820 L 75 985 L 110 760 L 145 990 L 185 800 L 230 985 L 280 850 L 325 990 L 380 870 L 430 985 L 480 920 L 0 1000 Z"
          fill={tuning.thornColor}
          opacity="0.92"
        />
        {/* Bottom-left rim light along the thorn tips */}
        <path
          d="M 0 870 L 22 990 L 50 820 L 75 985 L 110 760 L 145 990 L 185 800 L 230 985 L 280 850 L 325 990 L 380 870 L 430 985 L 480 920"
          fill="none"
          stroke={tuning.thornRimColor}
          strokeWidth="1.2"
          opacity="0.55"
        />
        {/* Bottom-left secondary thorn layer — shorter, in front */}
        <path
          d="M 0 1000 L 0 950 L 35 988 L 70 935 L 115 990 L 165 940 L 215 988 L 265 945 L 320 990 L 380 950 L 0 1000 Z"
          fill={tuning.thornColor}
          opacity="0.55"
        />

        {/* Bottom-right thorn cluster — mirror, slightly different rhythm */}
        <path
          d="M 1600 1000 L 1600 870 L 1578 990 L 1550 820 L 1525 985 L 1490 760 L 1455 990 L 1415 800 L 1370 985 L 1320 850 L 1275 990 L 1220 870 L 1170 985 L 1120 920 L 1600 1000 Z"
          fill={tuning.thornColor}
          opacity="0.92"
        />
        <path
          d="M 1600 870 L 1578 990 L 1550 820 L 1525 985 L 1490 760 L 1455 990 L 1415 800 L 1370 985 L 1320 850 L 1275 990 L 1220 870 L 1170 985 L 1120 920"
          fill="none"
          stroke={tuning.thornRimColor}
          strokeWidth="1.2"
          opacity="0.55"
        />
        <path
          d="M 1600 1000 L 1600 950 L 1565 988 L 1530 935 L 1485 990 L 1435 940 L 1385 988 L 1335 945 L 1280 990 L 1220 950 L 1600 1000 Z"
          fill={tuning.thornColor}
          opacity="0.55"
        />

        {/* Top-left small thorns — descending into the canvas */}
        <path
          d="M 0 0 L 28 55 L 60 22 L 95 70 L 135 30 L 170 65 L 0 80 Z"
          fill={tuning.thornColor}
          opacity="0.7"
        />
        {/* Top-right small thorns */}
        <path
          d="M 1600 0 L 1572 55 L 1540 22 L 1505 70 L 1465 30 L 1430 65 L 1600 80 Z"
          fill={tuning.thornColor}
          opacity="0.7"
        />
      </svg>

      {/* ── LAYER 3: Rupture cracks ─────────────────────────────────────────
        * A few sparse jagged lines radiating from off-screen anchor points,
        * reading as cracks in the world's surface. Kept extremely sparse so
        * the page does not feel busy — these are accents, not decoration. */}
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: tuning.crackOpacity,
          mixBlendMode: tuning.crackBlend,
          color: tuning.crackColor,
        }}
      >
        <g stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.8">
          {/* Crack radiating from bottom-left corner */}
          <path d="M 60 1000 L 180 820 L 230 700 L 340 540 L 400 380" />
          <path d="M 230 700 L 290 660 L 360 640" />
          <path d="M 340 540 L 410 500 L 470 510" />

          {/* Crack radiating from bottom-right corner */}
          <path d="M 1540 1000 L 1420 820 L 1370 700 L 1260 540 L 1200 380" />
          <path d="M 1370 700 L 1310 660 L 1240 640" />
          <path d="M 1260 540 L 1190 500 L 1130 510" />

          {/* A mid-canvas hairline crack */}
          <path d="M 720 -10 L 740 120 L 715 240 L 760 380" opacity="0.7" />
          <path d="M 880 1010 L 870 880 L 895 760 L 855 620" opacity="0.7" />
        </g>
      </svg>

      {/* ── LAYER 4: Soft inner vignette ───────────────────────────────────
        * A subtle dark ring at the viewport edges to focus the eye toward the
        * content area and reinforce the "looking through a portal" feel. Kept
        * lighter than the body atmospherics so the layer sum is balanced. */}
      <div
        className="absolute inset-0"
        style={{
          background: isDemonDark
            ? "radial-gradient(ellipse 110% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.45) 100%)"
            : "radial-gradient(ellipse 110% 80% at 50% 50%, transparent 60%, rgba(40,20,25,0.10) 100%)",
        }}
      />
    </div>
  );
}
