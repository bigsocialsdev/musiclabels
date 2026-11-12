import 'server-only';
export * from './index';
export { publishLegalDocument, getCurrentDocument, type NewLegalDocument } from './internal/documents';
export { recordAcceptance, checkAcceptance, acceptPending, type AcceptInput } from './internal/acceptance';
