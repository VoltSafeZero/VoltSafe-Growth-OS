---
name: Universal Drilldown Phase 2
description: Patterns and gotchas from implementing Pipeline & Insights drilldown routes and frontend wiring.
---

## Key patterns

**SQL style:** Both drilldown route files use `db.execute(sql.raw(...))` — NOT tagged template literals (`` sql`...` ``). Tests must check for `sql.raw(` not `` sql` ``.

**Metric safety:** `req.query.metric` is extracted into a `const metric` and then dispatched via `switch(metric)`. It is never interpolated into SQL strings. Tests should assert `switch (metric)` exists, not that `req.query.metric` is absent.

**Extending stat cards:** When adding drilldown to existing card components (MetricCard, KpiCard, StatCard), add an optional `onClick?: () => void` prop and apply `cursor-pointer hover:border-primary/40 transition-colors` conditionally. No new component needed.

**Inline import types:** Using `useState<import("@/components/shared/universal-drilldown-sheet").UniversalDrilldownConfig | null>` in a function body works for TypeScript but requires a separate top-level `import { UniversalDrilldownSheet }` for the JSX component to render. Always add both.

**Drilldown state pattern:**
```ts
const [drilldown, setDrilldown] = useState<UniversalDrilldownConfig | null>(null);
const dd = (metric: string, title: string) => () => setDrilldown({ metric, title });
```

**Sheet placement:** The `<UniversalDrilldownSheet>` must be inside the main page component's return, before the outer `</div>`. Watch for multi-component files (e.g. quotes.tsx has QuoteBuilder after QuotesPage) — insert before the function boundary.

**Why:** Phase 2 adds 53 drilldown metrics across Pipeline (28) and Insights (25) endpoints; the pattern is reused across 8+ pages.

**How to apply:** For any new page with stat cards, import `UniversalDrilldownSheet`, add drilldown state + `dd()` helper, wire `onClick={dd(metric, title)}` to each card, and place `<UniversalDrilldownSheet>` before the closing `</div>`.
