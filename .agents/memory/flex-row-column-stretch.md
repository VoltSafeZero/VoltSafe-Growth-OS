---
name: Kanban column flex stretch causes footer gap
description: Flex row default align-items:stretch forces all columns to equal height, causing flex-1 children to grow and push footers down with a visible gap.
---

In a horizontal flex board (kanban-style columns in a `flex` row), the default
`align-items: stretch` makes every column stretch to match the tallest sibling's
height — even if the row itself has no explicit height, just a `max-h-*` cap.

If a column's inner task-list uses `flex-1`, that list then expands to fill the
stretched column height, pushing any footer button (e.g. "+ Add a task") down
and creating a large blank gap below the last card in short columns.

**Why:** This is easy to misdiagnose as a `flex-1`/`mt-auto`/`justify-between`
problem on the column itself, but the real cause is the parent row's stretch
behavior, not the column's own layout.

**How to apply:** Add `items-start` to the flex row that contains the columns.
Keep `flex-1 overflow-y-auto min-h-0` on the inner scrollable list untouched —
it's still needed so long columns scroll instead of growing past the row's
`max-h` cap; only the row's cross-axis alignment needed fixing.
