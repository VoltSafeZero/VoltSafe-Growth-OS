---
name: Intent Modifiers
description: Lightweight tone/intent modifier layer on top of AI email generation; 10 modifiers, 6 categories, max 5 selectable.
---

## Key design decisions

**Shared config in `shared/intent-modifiers.ts`**  
Imported by server (`../../shared/intent-modifiers`) and client (`@shared/intent-modifiers`). Both sides use the same constants.

**Prompt injection order (systemPrompt array in generateSuggestedNextEmail):**
1. voiceProfileBlock (primary — not overridden)
2. modifierBlock (steers intent only)
3. Main email instruction text
4. Signature + formatting + content rules

**Why:** Modifiers placed after voice profile so the LLM reads the voice style first, then applies intent steering. `filter(Boolean)` removes the block entirely when empty, so zero-modifier case is identical to pre-feature behaviour.

**Route validation** (`server/routes.ts` near suggest-next-email endpoint):
- `Array.isArray(rawModifiers)` guard
- `.filter(id => typeof id === "string")` — unknown ids pass through here
- `.slice(0, 5)` — hard cap
- Unknown/invalid ids are silently dropped by `resolveIntentModifiers()` server-side (Map lookup returns undefined, filtered out)

**Frontend UX:**
- Modifiers are **NOT** applied on initial mount fetch — only when user clicks Regenerate
- `selectedModifiers` state starts as `[]`; collapsible panel starts closed
- Max-5 enforced in `toggleModifier()` — disabled attribute on extra checkboxes
- Regenerate button label: `"Regenerate (N)"` when N > 0
- Active modifier chips shown below "Why this email" reason block after generation

**No logging** — no `selected_intent_modifiers` column added; `crm_ai_summaries` stores CRM summaries, not generation logs. Spec said skip if no dedicated log table.
