import { internalMutation } from './_generated/server';
import { notify } from '../shared/shared';

/**
 * Sends the 24-hour and 1-hour interview reminders. Runs hourly from crons.ts;
 * each reminder is recorded on the interview so it is sent at most once.
 */
export const send = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const interviews = await ctx.db
      .query('interviews')
      .withIndex('by_status', (q) => q.eq('status', 'SCHEDULED'))
      .collect();

    let sent = 0;
    for (const interview of interviews) {
      const slot = await ctx.db.get(interview.slotId);
      if (!slot) continue;
      const hoursAway = (slot.startsAt - now) / 3600_000;
      const application = await ctx.db.get(interview.applicationId);
      if (!application) continue;
      const job = await ctx.db.get(application.jobId);

      if (!interview.reminder24SentAt && hoursAway <= 24 && hoursAway > 1) {
        await ctx.db.patch(interview._id, { reminder24SentAt: now });
        await notify(ctx, {
          userId: application.candidateId,
          type: 'REMINDER_24H',
          title: 'Interview tomorrow',
          body: `A reminder that your interview for ${job?.title ?? 'the role'} is tomorrow. Reply to the recruiter if you need to reschedule.`,
          data: { interviewId: interview._id, applicationId: application._id },
        });
        sent += 1;
      }

      if (!interview.reminder1SentAt && hoursAway <= 1 && hoursAway > 0) {
        await ctx.db.patch(interview._id, { reminder1SentAt: now });
        await notify(ctx, {
          userId: application.candidateId,
          type: 'REMINDER_1H',
          title: 'Interview in one hour',
          body: `Your interview for ${job?.title ?? 'the role'} starts in about one hour.`,
          data: { interviewId: interview._id, applicationId: application._id },
        });
        sent += 1;
      }
    }
    return { sent };
  },
});
