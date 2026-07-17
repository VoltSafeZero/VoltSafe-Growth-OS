---
name: Lead/Marina edit form mention fields
description: Notes, Competitors, ROI Story in EditLeadForm were plain inputs — wired to MentionInput.
---

## Rule
EditLeadForm in leads.tsx uses MentionInput for Notes, Competitors, and ROI Story.
The Competitors field uses `rows={1}` to preserve single-line appearance.

**Why:** These were plain `<Textarea>`/`<Input>` components that never supported @mention
autocomplete. Fixing required: import MentionInput+MentionInputHandle+tokensToCleanText,
add 3 refs, tokensToCleanText init, initFromTokenText useEffect, getTokenizedValue on submit.

**How to apply:** Any new text field added to EditLeadForm that should support @mentions
needs the same 4-step pattern: tokensToCleanText init → initFromTokenText on mount →
MentionInput component → getTokenizedValue on submit. The server-side PUT route also
needs a saveMentions() call for each mention-enabled field.

## Server side
PUT /api/leads/:id (routes.ts ~line 2874) calls saveMentions() for body.notes,
body.competitors, body.roiStory after res.json(result).

## Pinned by
tests/mention-token-leak.test.cjs Section 14 (18 assertions, checks 66-83).
