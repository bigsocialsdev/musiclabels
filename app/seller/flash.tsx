import { openFlash } from '@/lib/platform/flash';

/** The message the previous form action left in the URL (`?m=`), if the server sealed it. */
export function FlashBanner({ token }: { token?: string }) {
  const flash = openFlash(token);
  if (!flash) return null;
  return flash.kind === 'error' ? (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {flash.text}
    </p>
  ) : (
    <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
      {flash.text}
    </p>
  );
}
