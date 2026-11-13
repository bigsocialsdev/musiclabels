import 'server-only';
export { enqueueEmail, enqueueOpsAlert, processOutbox, type EmailMessage } from './internal/outbox';
export type { EmailSender } from './internal/sender';
