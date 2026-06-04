'use strict';
// Source-grep regression test for the calendar RSVP in-app feature.
// Verifies: backend route, CalendarInviteCard buttons, iframe interception,
// RSVP link detection helpers, in-place UI update, and error handling.
// No server or browser is needed — all checks are static source analysis.

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log('  \u2713 ' + label);
    passed++;
  } else {
    console.error('  \u2717 ' + label);
    failed++;
  }
}

const root = path.join(__dirname, '..');
const cardSrc  = fs.readFileSync(path.join(root, 'client/src/components/inbox/calendar-invite-card.tsx'), 'utf8');
const inboxSrc = fs.readFileSync(path.join(root, 'client/src/pages/gmail-inbox.tsx'), 'utf8');
const routesSrc = fs.readFileSync(path.join(root, 'server/routes.ts'), 'utf8');
const calSyncSrc = fs.readFileSync(path.join(root, 'server/calendar-sync.ts'), 'utf8');

// ── 1. Backend: POST /api/calendar/invitations/respond ────────────────────
console.log('\u2500\u2500 1. Backend route (\u2713 RSVP updates Google Calendar) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

check('route POST /api/calendar/invitations/respond defined',
  routesSrc.includes('/api/calendar/invitations/respond'));

check('route uses requireAuth',
  (() => {
    const idx = routesSrc.indexOf('/api/calendar/invitations/respond');
    const section = routesSrc.slice(Math.max(0, idx - 20), idx + 200);
    return section.includes('requireAuth');
  })());

const rsvpIdx = routesSrc.indexOf('/api/calendar/invitations/respond');
const rsvpSection = routesSrc.slice(rsvpIdx, rsvpIdx + 3500);

check('validates "accepted" response',   rsvpSection.includes('"accepted"') || rsvpSection.includes("'accepted'"));
check('validates "declined" response',   rsvpSection.includes('"declined"') || rsvpSection.includes("'declined'"));
check('validates "tentative" response',  rsvpSection.includes('"tentative"') || rsvpSection.includes("'tentative'"));
check('rejects unknown response (400)',  rsvpSection.includes('400'));
check('resolves uid from attachmentId',  rsvpSection.includes('parseCalendarInviteForAttachment'));
check('queries calendarConnections',     rsvpSection.includes('calendarConnections'));
check('rejects missing Google connection (422)',  rsvpSection.includes('422'));
check('calls getCalendarClient',         rsvpSection.includes('getCalendarClient'));
check('searches calendar by iCalUID',    rsvpSection.includes('iCalUID'));
check('handles missing event (404)',     rsvpSection.includes('404'));
check('patches attendees responseStatus', rsvpSection.includes('attendees') && rsvpSection.includes('patch'));
check('sends sendUpdates: "none"',        rsvpSection.includes('sendUpdates'));
check('returns { success: true }',        rsvpSection.includes('success: true') || rsvpSection.includes('success:true'));
check('returns responseStatus in response', rsvpSection.includes('responseStatus'));

check('getCalendarClient exported from calendar-sync.ts',
  calSyncSrc.includes('export async function getCalendarClient') ||
  calSyncSrc.includes('export function getCalendarClient'));

check('getCalendarClient imported in routes.ts',
  routesSrc.includes('getCalendarClient'));

// ── 2. CalendarInviteCard: RSVP buttons ───────────────────────────────────
console.log('\u2500\u2500 2. CalendarInviteCard RSVP buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

check('useMutation imported',            cardSrc.includes('useMutation'));
check('rsvpStatus state declared',       cardSrc.includes('rsvpStatus'));
check('rsvpError state declared',        cardSrc.includes('rsvpError'));
check('mutation calls RSVP endpoint',    cardSrc.includes('/api/calendar/invitations/respond'));
check('sends uid in mutation body',      cardSrc.includes('data?.uid') || cardSrc.includes('data.uid') || cardSrc.includes('"uid"'));
check('sends response in mutation body', cardSrc.includes('"response"') || cardSrc.includes('response:'));
check('only shown for METHOD:REQUEST',   cardSrc.includes('isRequest') || (cardSrc.includes('method') && cardSrc.includes('REQUEST')));
check('not shown when cancelled',        cardSrc.includes('isCancelled'));
// Buttons are rendered via .map() so the testid uses a template literal
// containing the loop variable: `button-rsvp-${resp}-${testKey}`. Check for
// the template pattern OR explicit strings (in case the code is refactored).
check('Accept button data-testid',       cardSrc.includes('button-rsvp-accepted') || cardSrc.includes('button-rsvp-${resp}'));
check('Decline button data-testid',      cardSrc.includes('button-rsvp-declined') || cardSrc.includes('button-rsvp-${resp}'));
check('Maybe/Tentative button testid',   cardSrc.includes('button-rsvp-tentative') || cardSrc.includes('button-rsvp-${resp}'));
check('loading state (Loader2 / isPending)', cardSrc.includes('isPending') || cardSrc.includes('Loader2'));
check('success status badge testid',     cardSrc.includes('badge-rsvp-status'));
check('error shown inline',              cardSrc.includes('text-rsvp-error') || cardSrc.includes('rsvpError'));
check('Change button to reset RSVP',     cardSrc.includes('button-rsvp-change') || (cardSrc.includes('Change') && cardSrc.includes('setRsvpStatus(null)')));

// ── 3. MessageBody: iframe RSVP link interception ────────────────────────
console.log('\u2500\u2500 3. MessageBody iframe interception \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

check('calendarAttachmentId prop on MessageBody', inboxSrc.includes('calendarAttachmentId'));
check('isCalendarRsvpLink helper exists',          inboxSrc.includes('function isCalendarRsvpLink'));
check('extractRsvpResponse helper exists',         inboxSrc.includes('function extractRsvpResponse'));
check('addEventListener on contentDocument',
  inboxSrc.includes('contentDocument') && inboxSrc.includes('addEventListener'));
check('capture-phase listener (true as 3rd arg)',
  inboxSrc.includes("addEventListener(\"click\", handleClick, true)") ||
  inboxSrc.includes("addEventListener('click', handleClick, true)"));
check('preventDefault called on RSVP links',
  inboxSrc.includes('e.preventDefault()') || inboxSrc.includes('e.preventDefault'));
check('stopPropagation called',
  inboxSrc.includes('e.stopPropagation()') || inboxSrc.includes('stopPropagation'));
check('fetch to RSVP endpoint',
  inboxSrc.includes('"/api/calendar/invitations/respond"') ||
  inboxSrc.includes("'/api/calendar/invitations/respond'"));
check('credentials: "include" on fetch',  inboxSrc.includes('credentials: "include"') || inboxSrc.includes("credentials: 'include'"));
check('rsvpBannerStatus state',           inboxSrc.includes('rsvpBannerStatus'));
check('rsvpBannerError state',            inboxSrc.includes('rsvpBannerError'));
check('removeEventListener cleanup',      inboxSrc.includes('removeEventListener'));
check('RSVP banner rendered (data-testid)', inboxSrc.includes('rsvp-intercept-banner'));
check('calendarAttachmentId passed at render site',
  inboxSrc.includes('calendarAttachmentId={ics'));
check('Fragment <> wraps CalendarInviteCard + MessageBody',
  inboxSrc.includes('<>') && inboxSrc.includes('CalendarInviteCard') && inboxSrc.includes('MessageBody'));

// ── 4. RSVP link detection logic ─────────────────────────────────────────
console.log('\u2500\u2500 4. RSVP link detection helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

check('detects calendar.google.com domain',  inboxSrc.includes('calendar.google.com'));
check('detects google.com/calendar domain',  inboxSrc.includes('google.com/calendar'));
check('detects action=respond',              inboxSrc.includes('action=respond'));
check('detects action=accept',               inboxSrc.includes('action=accept'));
check('detects action=decline',              inboxSrc.includes('action=decline'));
check('detects action=tentative',            inboxSrc.includes('action=tentative'));
check('detects rst=+eid= pattern',           inboxSrc.includes('rst=') && inboxSrc.includes('eid='));
check('rst=1 \u2192 accepted',               inboxSrc.includes('rst=1'));
check('rst=2 \u2192 declined',               inboxSrc.includes('rst=2'));
check('rst=3 \u2192 tentative',              inboxSrc.includes('rst=3'));
check('text "yes/accept/going" \u2192 accepted fallback', inboxSrc.includes('yes') && inboxSrc.includes('accept'));
check('text "no/decline" \u2192 declined fallback',       inboxSrc.includes('decline'));
check('text "maybe/tentative" \u2192 tentative fallback', inboxSrc.includes('maybe') || inboxSrc.includes('tentative'));
check('returns null for unrecognised links',  inboxSrc.includes('return null'));

// ── 5. Regression: normal links unaffected ───────────────────────────────
console.log('\u2500\u2500 5. Regression: normal links not intercepted \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

check('only calendar RSVP links intercepted (guard on isCalendarRsvpLink)',
  inboxSrc.includes('if (!isCalendarRsvpLink(href)) return'));
check('allow-same-origin sandbox still present',  inboxSrc.includes('allow-same-origin'));
check('allow-popups sandbox still present',        inboxSrc.includes('allow-popups'));
check('iframe srcDoc rendering unchanged',         inboxSrc.includes('srcDoc'));
check('body prop still passed to MessageBody',     inboxSrc.includes('body={msg.body}'));
check('isHtml prop still passed to MessageBody',   inboxSrc.includes('isHtml={msg.isHtml}'));
check('headerLeft prop still passed',              inboxSrc.includes('headerLeft={'));

// ── Result ────────────────────────────────────────────────────────────────
console.log('');
console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
const total = passed + failed;
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + total + ' total');

if (failed > 0) {
  process.exit(1);
}
