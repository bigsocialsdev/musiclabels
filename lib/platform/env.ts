import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  CRON_SECRET: z.string().min(16),
  TASKS_SECRET: z.string().min(16),
  // "id:base64(32 bytes)" pairs, comma separated.
  ENCRYPTION_KEYS: z.string().refine(
    (v) =>
      v.split(',').every((p) => {
        const [id, key] = p.split(':');
        return !!id && !!key && Buffer.from(key, 'base64').length === 32;
      }),
    'must be comma-separated "id:base64(32 bytes)" pairs',
  ),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  OPS_ALERT_EMAIL: z.email(),
  // Fingerprint screening vendor (F3: contract pending). Unset = screening reports "unavailable".
  ACRCLOUD_HOST: z.string().optional(),
  ACRCLOUD_ACCESS_KEY: z.string().optional(),
  ACRCLOUD_ACCESS_SECRET: z.string().optional(),
  // Phone OTP via MSG91, called from Supabase's "Send SMS" auth hook. Checked at use, so dev needs none.
  SEND_SMS_HOOK_SECRET: z.string().optional(), // "v1,whsec_<base64>" from the Supabase dashboard
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  // Razorpay (test mode outside production). Checked at use by the payments slice.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // [CA] billing config (PLAN §8.2/§8.3). Checked at use by invoicing/orders; never code constants.
  SUPPLIER_GSTIN: z.string().optional(),
  SUPPLIER_LEGAL_NAME: z.string().optional(),
  SUPPLIER_ADDRESS: z.string().optional(),
  SAC_CODE: z.string().optional(),
  GST_RATE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),
  DEFAULT_ROYALTY_RATE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),
  // [CA] payout tax config (PLAN §8.3, F5). Checked at use by the payouts slice.
  TDS_RATE_BPS: z.coerce.number().int().min(0).max(10_000).optional(),
  TDS_RATE_NO_PAN_BPS: z.coerce.number().int().min(0).max(10_000).optional(),
  TDS_FY_THRESHOLD_PAISE: z.coerce.number().int().min(0).optional(),
  RCM_ON_UNREGISTERED_SELLERS: z.enum(['true', 'false']).optional(),
  PAYOUT_MIN_PAISE: z.coerce.number().int().min(0).optional(),
  PAYOUT_DAY_OF_MONTH: z.coerce.number().int().min(1).max(28).optional(),
  // Clearance and disputes (PLAN §4.5/§4.6). Defaults apply when unset: 1 business day, 7 days. [Lawyer] confirms the refund window.
  CLEARANCE_TURNAROUND_BUSINESS_DAYS: z.coerce.number().int().min(1).max(10).default(1),
  CLAIM_RELEASE_REFUND_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // YouTube Data API key for bio-code channel checks (PLAN §11). Unset = channels are confirmed by an admin.
  YOUTUBE_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = result.data;
  const ids = env.ENCRYPTION_KEYS.split(',').map((p) => p.split(':')[0]);
  if (!ids.includes(env.ENCRYPTION_ACTIVE_KEY_ID)) {
    throw new Error('Invalid environment: ENCRYPTION_ACTIVE_KEY_ID is not in ENCRYPTION_KEYS');
  }
  return env;
}

let cached: Env | undefined;

/** Validated server env, parsed on first use so `next build` needs no secrets until a handler runs. */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}

/** Tests only: forget the cached parse after changing process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
