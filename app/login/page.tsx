import { signInAction } from "@/app/_actions/auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form action={signInAction}>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  );
}
