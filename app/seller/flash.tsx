import { openFlash } from '@/lib/platform/flash';
import { Notice } from './ui';

/** The message the previous form action left in the URL (`?m=`), if the server sealed it. */
export function FlashBanner({ token }: { token?: string }) {
  const flash = openFlash(token);
  if (!flash) return null;
  return flash.kind === 'error' ? (
    <Notice role="alert" tone="blocked">
      {flash.text}
    </Notice>
  ) : (
    <Notice role="status" tone="ok">
      {flash.text}
    </Notice>
  );
}
