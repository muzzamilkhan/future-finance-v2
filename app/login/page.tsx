export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <a href="/api/auth/signin"
         className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Sign in</a>
    </div>
  );
}
