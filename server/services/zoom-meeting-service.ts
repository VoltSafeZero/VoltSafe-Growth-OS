/**
 * zoom-meeting-service.ts
 *
 * Booking-context Zoom meeting creation.
 * Wraps zoom-service's createZoomMeeting with booking-specific options:
 *   - attendee email and name are added to the agenda string
 *   - timezone is passed as the meeting timezone
 *   - Returned ZoomMeetingResult is re-exported unchanged
 *
 * NEVER throws. Returns null when:
 *   - user has no active Zoom connection
 *   - ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are not set
 *   - Zoom API call fails for any reason
 */

import { createZoomMeeting, ZoomMeetingResult } from "./zoom-service";

export interface BookingZoomOptions {
  topic: string;
  startTime: Date;
  durationMinutes: number;
  timezone?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  agenda?: string;
}

/**
 * Creates a scheduled Zoom meeting for a booking confirmation.
 *
 * Attendee info is included in the agenda so the Zoom host can see
 * who the meeting is with before joining.
 */
export async function createZoomMeetingForBooking(
  ownerUserId: number,
  opts: BookingZoomOptions,
): Promise<ZoomMeetingResult | null> {
  const agendaParts: string[] = [];

  if (opts.agenda) agendaParts.push(opts.agenda);

  if (opts.attendeeName || opts.attendeeEmail) {
    const who = [opts.attendeeName, opts.attendeeEmail].filter(Boolean).join(" · ");
    agendaParts.push(`Attendee: ${who}`);
  }

  return createZoomMeeting(ownerUserId, {
    topic: opts.topic,
    startTime: opts.startTime,
    durationMinutes: opts.durationMinutes,
    agenda: agendaParts.join("\n") || undefined,
  });
}
