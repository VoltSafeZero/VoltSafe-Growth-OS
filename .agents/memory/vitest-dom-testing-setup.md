---
name: vitest DOM testing setup
description: How vitest + @testing-library is configured for real DOM component tests in this project.
---

## Rule
Use vitest with happy-dom for real DOM component tests of React hooks and components.

## How to apply
- Config: `vitest.config.ts` at root — `@vitejs/plugin-react`, `environment: "happy-dom"`, `include: "tests/**/*.vitest.{ts,tsx}"`
- Setup: `tests/vitest-setup.ts` — imports `@testing-library/jest-dom/vitest`, runs `cleanup()` + `vi.restoreAllMocks()` after each test
- Path aliases: `@` → `client/src`, `@shared`, `@assets` — all configured in vitest.config.ts resolve.alias
- Packages installed: vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, happy-dom, @vitejs/plugin-react

## Gotchas
- `vi.stubGlobal("fetch", mockFn)` is needed before render when hooks use `useQuery` with explicit `queryFn` that calls fetch
- Use `new QueryClient({ defaultOptions: { queries: { retry: 0 } } })` for test QueryClient (no retries)
- `fireEvent.pointerDown` (not `click`) to trigger mention selection since the component uses `onPointerDown` to prevent focus steal
- `requestAnimationFrame` in `insertMention` is handled by happy-dom transparently — no need to mock
- Run with: `npx vitest run tests/mention-real-dom.vitest.tsx --reporter=verbose`

**Why:** Component tests need real DOM to verify the @mention clean-text rule (textarea value, dropdown render), which source-grep alone cannot catch.
