type Fields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Fields) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  (level === 'error' ? console.error : console.log)(line);
}

/** Structured JSON logs for Vercel. Never pass secrets or personal data in fields. */
export const log = {
  info: (msg: string, f?: Fields) => emit('info', msg, f),
  warn: (msg: string, f?: Fields) => emit('warn', msg, f),
  error: (msg: string, f?: Fields) => emit('error', msg, f),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
