import { env } from '../env.js';
import { logger } from '../lib/logger.js';

export interface SmsMessage {
  to: string;
  body: string;
  channel?: 'sms' | 'whatsapp';
}

export interface SmsResult {
  provider: string;
  delivered: boolean;
  error?: string;
}

/**
 * SMS / WhatsApp provider interface.
 * Termii is the Nigerian gateway; `console` keeps local development free.
 */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  const channel = message.channel ?? 'sms';
  if (env.SMS_PROVIDER === 'termii' && env.TERMII_API_KEY) {
    try {
      const res = await fetch(`${env.TERMII_BASE_URL}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.TERMII_API_KEY,
          to: message.to,
          from: env.TERMII_SENDER_ID,
          sms: message.body.slice(0, 480),
          type: 'plain',
          channel: channel === 'whatsapp' ? 'whatsapp' : 'generic',
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (!res.ok) {
        return { provider: 'termii', delivered: false, error: payload.message ?? `HTTP ${res.status}` };
      }
      return { provider: 'termii', delivered: true };
    } catch (error) {
      logger.error('sms.send_failed', { provider: 'termii', message: (error as Error).message });
      return { provider: 'termii', delivered: false, error: (error as Error).message };
    }
  }
  if (env.NODE_ENV !== 'production') {
    logger.info('sms.console', { channel, to: `${message.to.slice(0, 4)}***${message.to.slice(-2)}` });
    // eslint-disable-next-line no-console
    console.log(`\n─── ${channel.toUpperCase()} (console provider) ───\nTo: ${message.to}\n${message.body}\n────────────────────────────\n`);
  }
  return { provider: 'console', delivered: true };
}
