import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = () => ({ ...process.env }) as Record<string, string | undefined>;

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    expect(parseEnv(valid()).ENCRYPTION_ACTIVE_KEY_ID).toBe('k1');
  });

  it('names the missing variable', () => {
    const env = valid();
    delete env.CRON_SECRET;
    expect(() => parseEnv(env)).toThrow(/CRON_SECRET/);
  });

  it('rejects short secrets and bad encryption keys', () => {
    expect(() => parseEnv({ ...valid(), TASKS_SECRET: 'short' })).toThrow(/TASKS_SECRET/);
    expect(() => parseEnv({ ...valid(), ENCRYPTION_KEYS: 'k1:c2hvcnQ=' })).toThrow(/ENCRYPTION_KEYS/);
  });

  it('requires the active key id to exist', () => {
    expect(() => parseEnv({ ...valid(), ENCRYPTION_ACTIVE_KEY_ID: 'nope' })).toThrow(/ACTIVE_KEY_ID/);
  });
});
