"use server";

import { signIn, signOut } from "@/server/auth";

// One-step Google sign-in: goes straight to Google, skipping the NextAuth
// provider-chooser interstitial (Google is the only provider).
export async function signInAction() {
  await signIn("google", { redirectTo: "/" });
}

// One-step sign-out: no confirmation page.
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
