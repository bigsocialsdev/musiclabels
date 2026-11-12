import 'server-only';
export * from './index';
export { publishLegalDocument, getCurrentDocument, type NewLegalDocument } from './internal/documents';
export { recordAcceptance, checkAcceptance, acceptPending, hasOrgAccepted, type AcceptInput } from './internal/acceptance';
