import nodemailer from 'nodemailer';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  provider: string;
  delivered: boolean;
  error?: string;
}

let smtpTransport: nodemailer.Transporter | null = null;

function getTransport() {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return smtpTransport;
}

async function sendWithResend(message: MailMessage): Promise<MailResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { provider: 'resend', delivered: false, error: `HTTP ${res.status} ${body.slice(0, 200)}` };
  }
  return { provider: 'resend', delivered: true };
}

/**
 * Email transport. `console` logs only a redacted recipient — the body can
 * contain personal data, so it is never printed in production.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  try {
    if (env.EMAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
      await getTransport().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { provider: 'smtp', delivered: true };
    }
    if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) {
      return await sendWithResend(message);
    }
    const masked = message.to.replace(/^(.{2}).*(@.*)$/, '$1***$2');
    logger.info('email.console', { to: masked, subject: message.subject });
    if (env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`\n─── EMAIL (console provider) ───\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n────────────────────────────────\n`);
    }
    return { provider: 'console', delivered: true };
  } catch (error) {
    logger.error('email.send_failed', { provider: env.EMAIL_PROVIDER, message: (error as Error).message });
    return { provider: env.EMAIL_PROVIDER, delivered: false, error: (error as Error).message };
  }
}

export function renderHtml(title: string, paragraphs: string[], cta?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${cta.url}" style="background:#0b5d3b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${cta.label}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f6f5ef;font-family:Inter,Arial,sans-serif;color:#1b2a22">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px">
    <div style="font-size:20px;font-weight:700;color:#0b5d3b;margin-bottom:18px">Iṣẹ́</div>
    <div style="background:#fff;border-radius:14px;padding:26px;border:1px solid #e6e2d4">
      <h1 style="font-size:19px;margin:0 0 16px">${title}</h1>
      ${body}${button}
    </div>
    <p style="font-size:12px;color:#6b7a71;margin-top:16px;line-height:1.5">AI helps screen applications; a human recruiter always makes the final decision. You can ask for human review from your application page.</p>
  </div></body></html>`;
}
