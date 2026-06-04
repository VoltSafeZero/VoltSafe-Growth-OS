---
name: AI Voice Profiles
description: Train From GPT system — how voice profiles are stored, injected into prompts, and surfaced in the email modal.
---

## Key facts

- Migration: `migrations/0012_ai_voice_profiles.sql` — 3 tables: `ai_voice_profiles`, `ai_voice_profile_files`, `user_ai_settings`. Seeds CEO Wattson global profile.
- Service: `server/services/ai-voice-profiles.ts` — CRUD + access control + `buildVoiceProfilePromptBlock`.
- Integration point: `server/services/crm-ai-summary.ts` — `generateSuggestedNextEmail` accepts optional `voiceProfileId, callerUserId, callerIsAdmin`; loads profile via `getVoiceProfileForPrompt`; injects `buildVoiceProfilePromptBlock` at top of system prompt. Failure is non-fatal (falls back silently).
- Route passes `voice_profile_id` from `req.body` to the service.
- Frontend page: `client/src/pages/ai-voice-profiles.tsx` at `/settings/voice-profiles`.
- Modal: `client/src/components/crm/suggested-next-email-modal.tsx` has voice selector dropdown; re-fetches suggestion on voice change; persists selection in localStorage key `voltsafe:voiceProfileId`.

## Access control rules
- `global` profiles: readable by everyone, editable/deletable only by admins.
- `user` profiles: visible only to `owner_user_id`; 404 returned for non-owner GET (not 403) to avoid enumeration.

**Why:** Consistent with `requireAccessibleLinkedObject` pattern in voice assistant — uniform 404 prevents authenticated users from enumerating other users' profile IDs.

## Prompt structure
`buildVoiceProfilePromptBlock` inserts: `=== VOICE PROFILE: Name ===`, then VOICE INSTRUCTIONS, STYLE RULES, FORBIDDEN PHRASES, PREFERRED PHRASES, EXAMPLE EMAILS (up to 3), KNOWLEDGE CONTEXT (from files), BACKGROUND KNOWLEDGE, `=== END VOICE PROFILE ===`.

## Tests
`tests/ai-voice-profiles.test.js` — 57 source-grep + API behavioural + DB state tests.
