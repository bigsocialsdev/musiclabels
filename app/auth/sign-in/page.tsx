import { SignInForm } from './sign-in-form';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && (
        <p role="alert" className="mt-2 text-red-600">
          Sign-in failed. Please try again.
        </p>
      )}
      <SignInForm next={next} />
    </main>
  );
}
