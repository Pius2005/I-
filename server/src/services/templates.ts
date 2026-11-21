import { env } from '../env.js';
import type { MailMessage } from './mailer.js';

/**
 * Notification copy. Every message restates that AI only recommends and a human
 * decides, and links to the relevant page.
 */
const app = () => env.APP_URL.replace(/\/$/, '');

export interface TemplateContext {
  candidateName?: string;
  jobTitle?: string;
  organisation?: string;
  date?: string;
  stage?: string;
  reason?: string;
  score?: number | null;
}

export interface RenderedTemplate {
  title: string;
  body: string;
  email: MailMessage | null;
  sms: string | null;
}

export type TemplateKey =
  | 'APPLICATION_RECEIVED'
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'INTERVIEW_CHANGED'
  | 'INTERVIEW_CANCELLED'
  | 'REMINDER_24H'
  | 'REMINDER_1H'
  | 'OUTCOME'
  | 'HUMAN_REVIEW_ACK';

export function renderTemplate(key: TemplateKey, ctx: TemplateContext, to: string): RenderedTemplate {
  const name = ctx.candidateName ?? 'there';
  const job = ctx.jobTitle ?? 'the role';
  const org = ctx.organisation ?? 'the hiring team';
  const link = `${app()}/candidate/applications`;

  const make = (title: string, body: string, subject: string, sms: string, path = '/candidate/applications'): RenderedTemplate => ({
    title,
    body,
    email: {
      to,
      subject,
      text: `${body}\n\nOpen Iṣẹ́: ${app()}${path}`,
      html: undefined,
    },
    sms,
  });

  switch (key) {
    case 'APPLICATION_RECEIVED':
      return make(
        'Application received',
        `Hello ${name}, we received your application for ${job} at ${org}. AI will help the hiring team review it against the published criteria, and a person will make the final decision. You can track progress in your dashboard.`,
        `Application received — ${job}`,
        `Ise: application received for ${job}. Track it: ${link}`,
      );
    case 'SHORTLISTED':
      return make(
        'You have been shortlisted',
        `Hello ${name}, you have been shortlisted for ${job} at ${org}. The hiring team will contact you with interview options. Shortlisting is a human decision; the AI score informed but did not decide it.`,
        `You are shortlisted for ${job}`,
        `Ise: you are shortlisted for ${job}. Check your dashboard for interview slots.`,
      );
    case 'INTERVIEW_SCHEDULED':
      return make(
        'Interview scheduled',
        `Hello ${name}, your interview for ${job} is scheduled for ${ctx.date ?? 'the agreed time'}. You can reschedule or cancel from your dashboard, subject to the cut-off rules.`,
        `Interview scheduled — ${job}`,
        `Ise: interview for ${job} on ${ctx.date ?? ''}. Details in your dashboard.`,
      );
    case 'INTERVIEW_CHANGED':
      return make(
        'Interview rescheduled',
        `Hello ${name}, your interview for ${job} has been moved to ${ctx.date ?? 'a new time'}. The updated calendar file is available in your dashboard.`,
        `Interview rescheduled — ${job}`,
        `Ise: interview for ${job} moved to ${ctx.date ?? 'new time'}.`,
      );
    case 'INTERVIEW_CANCELLED':
      return make(
        'Interview cancelled',
        `Hello ${name}, your interview for ${job} on ${ctx.date ?? 'the scheduled date'} has been cancelled. ${ctx.reason ? `Reason: ${ctx.reason}.` : ''} The hiring team can offer a new time.`,
        `Interview cancelled — ${job}`,
        `Ise: interview for ${job} cancelled. See dashboard for next steps.`,
      );
    case 'REMINDER_24H':
      return make(
        'Interview tomorrow',
        `Hello ${name}, a reminder that your interview for ${job} is tomorrow (${ctx.date ?? ''}). Reply to the recruiter if you need to reschedule.`,
        `Reminder: interview tomorrow — ${job}`,
        `Ise: interview for ${job} is tomorrow.`,
      );
    case 'REMINDER_1H':
      return make(
        'Interview in one hour',
        `Hello ${name}, your interview for ${job} starts in about one hour (${ctx.date ?? ''}).`,
        `Reminder: interview in 1 hour — ${job}`,
        `Ise: interview for ${job} starts in 1 hour.`,
      );
    case 'OUTCOME':
      return make(
        'Update on your application',
        `Hello ${name}, there is an update on your application for ${job}: ${ctx.stage ?? 'a decision has been recorded'}. ${
          ctx.reason ? `Note from the team: ${ctx.reason}.` : ''
        } You can request human review of any AI-assisted screening from your application page.`,
        `Update on your application — ${job}`,
        `Ise: update on ${job}. Open your dashboard.`,
      );
    case 'HUMAN_REVIEW_ACK':
      return make(
        'Human review requested',
        `Hello ${name}, your request for human review of your application for ${job} has been recorded. A recruiter will review your application manually.`,
        `Human review requested — ${job}`,
        `Ise: human review requested for ${job}. We will update you.`,
      );
  }
}
