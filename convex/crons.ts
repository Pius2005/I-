import { cronJobs } from 'convex/server';
import { internalRefs } from '../shared/refs';

const crons = cronJobs();

// Interview reminders: in-app notification 24 hours and 1 hour before the slot.
crons.hourly(
  'interview reminders',
  { minuteUTC: 5 },
  internalRefs.reminders.send,
);

export default crons;
