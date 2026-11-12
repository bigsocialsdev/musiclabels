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
