import 'server-only';
import type { AdminContext } from '@/lib/identity/server';
import { requireAdminArea } from '../guard';

/** Page/action gate for the verification admin area: signed in, admin with `verification`, session at AAL2. */
export const requireVerificationAdmin = (returnTo: string): Promise<AdminContext> => requireAdminArea('verification', returnTo);
