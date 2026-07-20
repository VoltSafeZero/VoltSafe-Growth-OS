"use strict";
const fs = require("fs");

let passed = 0;
let failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else       { console.error(`  ✗ ${label}`); failed++; }
}

// ── Read source files ──────────────────────────────────────────────────────
const inbox   = fs.readFileSync("client/src/pages/gmail-inbox.tsx", "utf8");
const hub     = fs.readFileSync("client/src/pages/assets.tsx", "utf8");
const routes  = fs.readFileSync("server/routes.ts", "utf8");

console.log("=== Asset Library & Document Hub Fix Tests ===");

// ── Section 1: Picker default tab ────────────────────────────────────────
console.log('\n── 1. Picker default tab ──');
ok('default assetTab is "all"', inbox.includes('useState<string>("all")') || inbox.includes(`useState("all")`));
ok('no longer defaults to "recommended"', !inbox.includes('useState<string>("recommended")') && !inbox.includes('useState("recommended")'));

// ── Section 2: Picker tab chips include "All" and "General" ─────────────
console.log('\n── 2. Picker tab chips ──');
ok('tab chip: All', inbox.includes('{ key: "all"') && inbox.includes('label: "All"'));
ok('tab chip: General', inbox.includes('{ key: "general"') && inbox.includes('label: "General"'));
ok('tab chip: Recommended still present', inbox.includes('{ key: "recommended"'));
ok('tab chip: Sales still present', inbox.includes('{ key: "sales"'));
ok('tab chip: Internal still present', inbox.includes('{ key: "internal"'));

// ── Section 3: Images no longer excluded from picker ─────────────────────
console.log('\n── 3. Image exclusion removed ──');
ok('image filter removed from picker list render', !inbox.includes('.filter(a => !(a.mimeType || "").startsWith("image/"))'));
ok('all assets rendered (no mimeType filter on render)', inbox.includes('(assetsQuery.data || []).map((asset) => {'));

// ── Section 4: CTA hint is softer (not a hard blocker) ───────────────────
console.log('\n── 4. CTA hint ──');
ok('CTA hint still present for inline images', inbox.includes('Insert Tracked CTA'));
ok('CTA hint no longer says "hidden here"', !inbox.includes('Image files are hidden here'));
ok('CTA hint uses "inline" language', inbox.includes('embed tracked images') || inbox.includes('inline'));

// ── Section 5: Empty state improvements ──────────────────────────────────
console.log('\n── 5. Empty state improvements ──');
ok('Show all assets button in empty state', inbox.includes('Show all assets'));
ok('Go to Document Hub link', inbox.includes('Go to Document Hub'));

// ── Section 6: Server GET /api/assets search expansion ───────────────────
console.log('\n── 6. Server search expansion ──');
ok('search includes originalName', routes.includes('a.originalName.toLowerCase().includes(q)'));
ok('search includes useCase', routes.includes('(a.useCase ?? "general").toLowerCase().includes(q)'));
ok('search includes category', routes.includes('(a.category ?? "").toLowerCase().includes(q)'));
ok('search includes assetType', routes.includes('(a.assetType ?? "").toLowerCase().includes(q)'));

// ── Section 7: Server PATCH /api/assets/:id extended fields ──────────────
console.log('\n── 7. Server PATCH extended fields ──');
ok('PATCH accepts useCase', routes.includes('if (useCase !== undefined) updateData.useCase'));
ok('PATCH accepts visibility', routes.includes('if (visibility !== undefined) updateData.visibility'));
ok('PATCH accepts isFavorite', routes.includes('if (isFavorite !== undefined) updateData.isFavorite'));
ok('PATCH accepts assetType', routes.includes('if (assetType !== undefined) updateData.assetType'));
ok('PATCH returns 404 if not found', routes.includes("if (!updated) return res.status(404).json({ message: \"Asset not found\" })"));
ok('PATCH strips fileData from response', routes.includes('res.json({ ...updated, fileData: undefined })'));

// ── Section 8: Server POST /api/assets extended fields ───────────────────
console.log('\n── 8. Server POST extended fields ──');
ok('POST accepts useCase from body', routes.includes('const { folderId, useCase, visibility } = req.body'));
ok('POST stores useCase', routes.includes('useCase: useCase || null'));
ok('POST stores visibility', routes.includes("visibility: visibility || \"customer_safe\""));

// ── Section 9: Document Hub AssetItem type ───────────────────────────────
console.log('\n── 9. Document Hub AssetItem type ──');
ok('AssetItem has useCase field', hub.includes('useCase?: string | null'));
ok('AssetItem has visibility field', hub.includes('visibility?: string | null'));
ok('AssetItem has isFavorite field', hub.includes('isFavorite?: boolean'));
ok('AssetItem has usageCount field', hub.includes('usageCount?: number'));
ok('AssetItem has lastAttachedAt field', hub.includes('lastAttachedAt?: string | null'));

// ── Section 10: Document Hub upload dialog fields ────────────────────────
console.log('\n── 10. Upload dialog fields ──');
ok('Upload dialog has useCase state', hub.includes('const [useCase, setUseCase]'));
ok('Upload dialog has visibility state', hub.includes('const [visibility, setVisibility]'));
ok('Upload dialog sends useCase to server', hub.includes('formData.append("useCase", useCase)'));
ok('Upload dialog sends visibility to server', hub.includes('formData.append("visibility", visibility)'));
ok('USE_CASES constant defined', hub.includes('const USE_CASES = ['));
ok('VISIBILITIES constant defined', hub.includes('const VISIBILITIES = ['));

// ── Section 11: Document Hub page header ─────────────────────────────────
console.log('\n── 11. Document Hub page header ──');
ok('page title is "Document Hub"', hub.includes('"Document Hub"') || hub.includes('>Document Hub<'));
ok('no longer "Sales & Marketing Assets"', !hub.includes('Sales & Marketing Assets'));

// ── Section 12: Document Hub edit metadata dialog ────────────────────────
console.log('\n── 12. Edit metadata dialog ──');
ok('EditMetaDialog component exists', hub.includes('function EditMetaDialog('));
ok('EditMetaDialog has useCase select', hub.includes('select-edit-usecase'));
ok('EditMetaDialog has visibility select', hub.includes('select-edit-visibility'));
ok('onEdit prop on AssetCard', hub.includes('onEdit: (asset: AssetItem) => void'));

// ── Section 13: Document Hub favorites ──────────────────────────────────
console.log('\n── 13. Favorites ──');
ok('onToggleFavorite prop on AssetCard', hub.includes('onToggleFavorite: (id: number'));
ok('favoriteMutation defined', hub.includes('const favoriteMutation = useMutation'));
ok('PATCH isFavorite called', hub.includes('{ isFavorite }'));
ok('Star icon imported', hub.includes('Star,'));
ok('StarOff icon imported', hub.includes('StarOff,'));

// ── Section 14: Document Hub search expansion ────────────────────────────
console.log('\n── 14. Document Hub search ──');
ok('search includes originalName', hub.includes('a.originalName.toLowerCase().includes(q)'));
ok('search includes useCase', hub.includes('(a.useCase ?? "general").toLowerCase().includes(q)'));
ok('search includes useCaseLabel', hub.includes('useCaseLabel(a.useCase).toLowerCase().includes(q)'));

// ── Section 15: Document Hub stats bar ───────────────────────────────────
console.log('\n── 15. Stats bar ──');
ok('statsBar defined', hub.includes('const statsBar = ['));
ok('statsBar shows Total', hub.includes('label: "Total"'));
ok('statsBar shows Favorites count', hub.includes('label: "Favorites"'));
ok('statsBar shows Restricted count', hub.includes('label: "Restricted"'));

// ── Section 16: Visibility helper functions ──────────────────────────────
console.log('\n── 16. Visibility helpers ──');
ok('visLabel helper', hub.includes('function visLabel('));
ok('visColor helper', hub.includes('function visColor('));
ok('useCaseLabel helper', hub.includes('function useCaseLabel('));
ok('badge shows visLabel', hub.includes('visLabel(asset.visibility)'));
ok('badge shows visColor', hub.includes('visColor(asset.visibility)'));

console.log(`\n─────────────────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`─────────────────────────────────────────────────────────────`);
process.exit(failed > 0 ? 1 : 0);
