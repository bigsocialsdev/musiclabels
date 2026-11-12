import { handleSendSmsHook } from '@/lib/identity/server';
import { errorMessage, log } from '@/lib/platform/log';

export const dynamic = 'force-dynamic';

/** Supabase "Send SMS" auth hook: delivers phone-login OTPs through MSG91. Signature-verified. */
export async function POST(req: Request) {
  try {
    const status = await handleSendSmsHook(req);
    return Response.json(status === 200 ? {} : { error: { message: 'rejected' } }, { status });
  } catch (e) {
    log.error('sms hook failed', { error: errorMessage(e) });
    return Response.json({ error: { message: 'send failed' } }, { status: 500 });
  }
}
