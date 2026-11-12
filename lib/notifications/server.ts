import 'server-only';
export { enqueueEmail, processOutbox, type EmailMessage } from './internal/outbox';
export type { EmailSender } from './internal/sender';
