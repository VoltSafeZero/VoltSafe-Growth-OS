// Regression test for the sidebar "i" help indicator.
//
// History: a prior codemod replaced lucide-react `Info` icon usages across
// 14 page/component files, but the sidebar's small "i" marks (next to
// Pipeline, Operations, Insights, Marketing, Capital, Feed CORTEX, Learn,
// etc.) were NOT coming from lucide Info at all — they came from a literal
// "i" text glyph rendered by `FieldHelp` (client/src/components/help/field-help.tsx),
// styled with `font-serif italic`, which is why it visually looked like a
// stray "/" or slanted mark instead of a real icon.
//
// This test pins:
//   1. FieldHelp renders the shared SVG InfoIcon component, not literal text.
//   2. No leftover `font-serif italic` "i" glyph pattern in field-help.tsx.
//   3. The shared InfoIcon is an inline SVG using currentColor (not an <img>
//      asset), so it works in both light and dark mode without extra assets.
//   4. app-sidebar.tsx does not import lucide-react's `Info` directly.
//   5. No sidebar/help file uses a CSS generated-content "i" or "/" indicator.

const fs = require("fs");
const path = require("path");

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    console.error(`FAIL: ${name}`);
    failures++;
  }
}

const fieldHelpPath = path.join(__dirname, "..", "client/src/components/help/field-help.tsx");
const infoIconPath = path.join(__dirname, "..", "client/src/components/icons/info-icon.tsx");
const sidebarPath = path.join(__dirname, "..", "client/src/components/dashboard/app-sidebar.tsx");

const fieldHelpSrc = fs.readFileSync(fieldHelpPath, "utf8");
const infoIconSrc = fs.readFileSync(infoIconPath, "utf8");
const sidebarSrc = fs.readFileSync(sidebarPath, "utf8");

// 1. FieldHelp uses the shared InfoIcon component.
check(
  "field-help.tsx imports the shared InfoIcon component",
  /import\s*\{\s*InfoIcon\s*\}\s*from\s*["']@\/components\/icons\/info-icon["']/.test(fieldHelpSrc)
);
check(
  "field-help.tsx renders <InfoIcon ... /> inside the trigger button",
  /<InfoIcon\b[^>]*\/>/.test(fieldHelpSrc)
);

// 2. No literal "i" glyph left behind (the old bug).
check(
  'field-help.tsx no longer renders a bare literal "i" text node as the trigger content',
  !/>\s*i\s*<\/button>/.test(fieldHelpSrc)
);
check(
  "field-help.tsx no longer uses the font-serif italic single-glyph styling",
  !/font-serif italic/.test(fieldHelpSrc)
);

// 3. Shared InfoIcon is an SVG using currentColor (works in light + dark
// automatically), not a raster image tied to one theme.
check(
  "InfoIcon component renders an inline <svg>, not an <img>",
  /<svg\b/.test(infoIconSrc) && !/<img\b/.test(infoIconSrc)
);
check(
  "InfoIcon component uses currentColor so it adapts to light/dark mode",
  /currentColor/.test(infoIconSrc)
);
check(
  "InfoIcon component does not depend on a screenshot/image asset import",
  !/from\s*["']@\/assets\//.test(infoIconSrc)
);

// 4. Sidebar does not pull in lucide's Info icon directly (it uses FieldHelp,
// which itself uses the shared InfoIcon).
check(
  "app-sidebar.tsx does not import lucide-react's Info icon",
  !/import\s*\{[^}]*\bInfo\b[^}]*\}\s*from\s*["']lucide-react["']/.test(sidebarSrc)
);
check(
  "app-sidebar.tsx wires SECTION_HELP_KEYS entries through <FieldHelp .../>",
  /SECTION_HELP_KEYS\[section\.id\]/.test(sidebarSrc) && /<FieldHelp/.test(sidebarSrc)
);

// 5. No CSS-generated-content indicator standing in for the icon.
const helpDir = path.join(__dirname, "..", "client/src/components/help");
const dashboardDir = path.join(__dirname, "..", "client/src/components/dashboard");
function collectFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(tsx|ts|css)$/.test(f))
    .map((f) => path.join(dir, f));
}
const scanFiles = [...collectFiles(helpDir), ...collectFiles(dashboardDir)];
let foundBadContent = false;
for (const file of scanFiles) {
  const src = fs.readFileSync(file, "utf8");
  if (/content:\s*["']i["']/.test(src) || /content:\s*["']\/["']/.test(src)) {
    console.error(`FAIL: found CSS generated-content "i"/"/" indicator in ${file}`);
    foundBadContent = true;
  }
}
check("no sidebar/help file uses CSS content: \"i\" or content: \"/\" for the indicator", !foundBadContent);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll sidebar info-icon checks passed.");
}
