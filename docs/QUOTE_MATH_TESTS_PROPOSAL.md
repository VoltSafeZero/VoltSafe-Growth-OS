# Quote Math Test Suite — Proposal

**Scope**: Identify the math functions backing quote totals and propose a focused test suite for them.
**Status**: Proposal only — no tests written.

---

## Where the math lives

The quote math is split across three layers, with the bulk on the client:

| Layer       | File                                | Functions                                                              | Tested today?                              |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| Client      | `client/src/pages/quotes.tsx`       | `makeLineItem` (129–145), `applyGlobalDiscount` (1144–1153), inline subtotal/tax/deposit calc in `QuoteBuilder` (1132–1140) | No direct unit tests                       |
| Server PDF  | `server/quote-generator.ts`         | `generateInvoiceHtml` deposit/production/install milestone math (74–76), `fmt` currency formatter | Indirect via `tests/quote-workflow.test.js` (state machine only — does not assert numbers) |
| Server API  | `server/routes.ts`                  | `POST /api/quotes` (3290–3310), `PATCH .../transition` (3561–3684) — these persist whatever the client sent | Yes — workflow only                        |
| Schema      | `shared/schema.ts`                  | `quotes`, `quote_line_items`, `price_lists`, `price_list_items` — defines `qty`, `list_price`, `discount_percent`, `unit_price`, `line_total`, `is_recurring`, `tax_rate`, deposit/production/install percentages | N/A                                        |

**Key finding**: The server trusts the client's totals. `POST /api/quotes` records what the client sent. There is no server-side recompute. Any test suite worth writing must therefore cover both layers, or move the math to a shared helper.

---

## Proposed shared helper (prerequisite)

Before tests can be useful, the math should live in **one** place that both client and server can import. Today the same formula is implemented twice (once in `quotes.tsx`, once partially in `quote-generator.ts`).

**Recommendation**: Extract to `shared/quote-math.ts`:

```ts
// shared/quote-math.ts (proposed — not implemented)
export function computeLineTotal(opts: { qty: number; listPrice: number; discountPercent: number }): {
  unitPrice: number;
  lineTotal: number;
};

export function computeQuoteTotals(lines: QuoteLineInput[], opts: {
  taxRate: number;
  taxAmountOverride?: number;
  depositPercent: number;
  productionPercent: number;
  installPercent: number;
}): {
  hardwareSubtotal: number;
  softwareSubtotal: number;
  recurringSubtotal: number;  // SaaS lines isolated
  oneTimeSubtotal: number;    // Hardware lines isolated
  subtotal: number;
  taxAmount: number;
  total: number;
  depositAmount: number;
  productionAmount: number;
  installAmount: number;
};

export function formatCurrency(amount: number, currencyCode: string, locale?: string): string;
```

Once extracted, the client imports it, the server imports it inside `POST /api/quotes` to recompute and reject mismatches, and the test file imports it once.

---

## Proposed test file

`tests/quote-math.test.js` (or `.ts` if the project moves to TS tests). Follows the existing `tests/quote-workflow.test.js` style — plain Node `assert` so no new framework is needed.

### Section A — Per-line math (`computeLineTotal`)

| Test                                  | Input                                              | Expected                          |
| ------------------------------------- | -------------------------------------------------- | --------------------------------- |
| Basic line                            | qty=2, listPrice=100, discount=0                   | unitPrice=100, lineTotal=200      |
| Whole-percent discount                | qty=1, listPrice=100, discount=10                  | unitPrice=90, lineTotal=90        |
| Fractional discount                   | qty=3, listPrice=99.99, discount=12.5              | unitPrice=87.49, lineTotal=262.47 (rounded) |
| Zero quantity                         | qty=0, listPrice=100, discount=10                  | lineTotal=0 (no NaN, no negative) |
| Zero list price                       | qty=5, listPrice=0, discount=20                    | lineTotal=0                       |
| Discount = 100%                       | qty=4, listPrice=50, discount=100                  | lineTotal=0                       |
| Discount > 100% (data corruption guard)| qty=1, listPrice=100, discount=120                | Should clamp to 0 OR throw — current code returns negative. Spec the desired behavior. |
| Negative qty (data corruption guard)  | qty=-1, listPrice=100, discount=0                  | Same — clamp or throw.            |
| Large numbers (no overflow)           | qty=1_000_000, listPrice=999.99, discount=0        | lineTotal=999_990_000             |
| Floating-point rounding edge          | qty=3, listPrice=10.10, discount=33.33             | Asserts result is rounded to 2 dp, no `.000000004` artifact |

### Section B — Quote totals (`computeQuoteTotals`)

| Test                                                          | Setup                                                                            | Expected                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Single hardware line, no tax, no discount                     | 1 line: hardware $1000                                                           | subtotal=1000, total=1000, hardwareSubtotal=1000, recurring=0     |
| Single SaaS line (recurring)                                  | 1 line: SaaS $50/mo                                                              | softwareSubtotal=50, recurring=50, oneTime=0                      |
| Mixed quote — hardware + SaaS                                 | 1 hw $5000, 1 saas $200                                                          | hardware=5000, software=200, subtotal=5200, recurring=200         |
| Tax applied to taxable subtotal                               | hw $1000, taxRate=5%                                                             | taxAmount=50, total=1050                                          |
| Tax override (manual taxAmount wins)                          | hw $1000, taxRate=5%, taxAmountOverride=42                                       | taxAmount=42, total=1042                                          |
| Multi-line, multi-currency price-list resolution              | 2 lines from CAD price list                                                      | All totals in CAD, formatted with C$ prefix                       |
| Discount applied per-line then summed                         | 2 hw lines, one with 10% disc                                                    | Subtotal reflects per-line discount, not whole-quote discount     |
| `applyGlobalDiscount` recomputes every line                   | 3 lines, apply 15% global discount                                               | Each line.discountPercent=15, totals re-derived correctly         |
| Deposit/production/install percentages sum to 100%            | total=10000, deposit=20%, production=50%, install=30%                            | depositAmount=2000, productionAmount=5000, installAmount=3000     |
| Deposit/production/install percentages sum to 99% (rounding)  | total=10000, deposit=33%, production=33%, install=33%                            | Last bucket absorbs rounding remainder so sum equals total exactly |
| Empty line list                                               | lines=[]                                                                         | subtotal=0, total=0, no NaN                                       |
| Many lines (perf sanity, not a real assertion)                | 1000 lines                                                                       | Computes in <50ms                                                 |

### Section C — Currency formatting (`formatCurrency`)

| Test                                  | Input                              | Expected                  |
| ------------------------------------- | ---------------------------------- | ------------------------- |
| USD basic                             | 1234.5, "USD"                      | "$1,234.50"               |
| CAD with explicit symbol              | 1000, "CAD"                        | "C$1,000.00" or "CA$1,000.00" — assert against current `CURRENCY_SYMBOLS` table |
| MXN                                   | 100, "MXN", locale="es-MX"         | "$100.00 MXN" (or current convention) |
| Zero                                  | 0, "USD"                           | "$0.00"                   |
| Sub-cent                              | 0.005, "USD"                       | "$0.01" (banker's rounding or half-up — assert which) |
| Large                                 | 1_234_567.89, "USD"                | "$1,234,567.89"           |
| Negative (refund / credit display)    | -250, "USD"                        | "-$250.00" or "($250.00)" — pick a convention |

### Section D — Server/client parity (integration-style)

If the shared helper extraction happens, add 3 cross-layer tests:

| Test                                                            | What it asserts                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Client-computed total matches server recompute                  | Build a quote in the client, POST to `/api/quotes`, server re-derives totals, compare. |
| Server rejects POST with mismatched totals                      | POST a quote where `total !== sum(lines.lineTotal) + tax`. Server should 400 (after the recompute hardening lands). |
| `quote-generator.ts` PDF math matches `computeQuoteTotals`      | Generate the invoice HTML, parse the milestone amounts, assert they match the helper output. |

---

## What this proposal does NOT cover (and why)

- **Discount stacking with promotional codes** — not supported in the schema today.
- **Multi-currency conversion** — quotes are fixed to a single currency; no cross-rate math.
- **Tax exemptions / tax holiday rules** — only flat percentage today.
- **Per-line tax overrides** — `quote_line_items` has no per-line tax column.

These are deliberately out of scope until the underlying features exist.

---

## Effort estimate

- Shared helper extraction: ~2 hours (refactor only — math doesn't change).
- Test file (~30 cases listed above): ~3 hours.
- CI wiring: trivial — add a `quote-math` workflow alongside the existing `tests/*` workflows.

**Total: ~half a day, including the helper refactor.** The tests themselves are cheap once the helper exists.

**Order of operations** (recommended):
1. Extract `shared/quote-math.ts`. Refactor `quotes.tsx` and `quote-generator.ts` to import it. No behavior change.
2. Add the test file.
3. Wire into the test workflow list.
4. Then — and only then — add the server-side recompute in `POST /api/quotes` to reject client-tampered totals.
