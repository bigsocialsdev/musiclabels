import { Resend } from 'resend';
import { getEnv } from '@/lib/platform/env';

export interface EmailSender {
  /** `idempotencyKey` lets the provider drop a duplicate if a crashed run retries the same row. */
  send(msg: { to: string; subject: string; html: string; idempotencyKey: string }): Promise<void>;
}

export class ResendSender implements EmailSender {
  private client = new Resend(getEnv().RESEND_API_KEY);

  async send({ to, subject, html, idempotencyKey }: Parameters<EmailSender['send']>[0]) {
    const { error } = await this.client.emails.send(
      { from: getEnv().EMAIL_FROM, to, subject, html },
      { idempotencyKey },
    );
    if (error) throw new Error(`Resend: ${error.message}`);
  }
}
