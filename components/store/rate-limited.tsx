/** Shown in place of a public page when its address has used up its allowance (a server component cannot set a 429). */
export function RateLimited() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-title">Too many requests</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">
        You have made a lot of requests in a short time. Wait a minute, then try again.
      </p>
    </main>
  );
}
