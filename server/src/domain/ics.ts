/**
 * ICS (iCalendar) generation for interview invitations.
 * Timezone-safe: timestamps are emitted in UTC so any calendar client agrees.
 */

function formatUtc(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export interface IcsInput {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string | null;
  organiserEmail: string;
  attendeeEmail?: string | null;
  sequence?: number;
  cancelled?: boolean;
  method?: 'REQUEST' | 'CANCEL' | 'PUBLISH';
}

export function buildIcs(input: IcsInput): string {
  const now = formatUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ise//Interview Scheduling//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method ?? (input.cancelled ? 'CANCEL' : 'REQUEST')}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${formatUtc(input.start)}`,
    `DTEND:${formatUtc(input.end)}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `SUMMARY:${escapeText(input.summary)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    `LOCATION:${escapeText(input.location ?? 'Online')}`,
    `ORGANIZER;CN=Ise:mailto:${input.organiserEmail}`,
  ];
  if (input.attendeeEmail) {
    lines.push(`ATTENDEE;CN=Candidate;RSVP=TRUE:mailto:${input.attendeeEmail}`);
  }
  if (input.cancelled) lines.push('STATUS:CANCELLED');
  else lines.push('STATUS:CONFIRMED');
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Interview reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.join('\r\n');
}

export interface SlotInput {
  startsAt: Date;
  slotMinutes: number;
}

/** Generates non-overlapping candidate slots inside an availability window. */
export function generateSlots(window: {
  startsAt: Date;
  endsAt: Date;
  slotMinutes: number;
  bufferMinutes: number;
}): SlotInput[] {
  const slots: SlotInput[] = [];
  const step = (window.slotMinutes + window.bufferMinutes) * 60_000;
  if (step <= 0) return slots;
  for (let t = window.startsAt.getTime(); t + window.slotMinutes * 60_000 <= window.endsAt.getTime(); t += step) {
    slots.push({ startsAt: new Date(t), slotMinutes: window.slotMinutes });
  }
  return slots;
}
