export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl ?? "/";
  const signinHref = `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <a
        href={signinHref}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        Sign in
      </a>
    </div>
  );
}
