import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";

export function inviteState(
  invite: { acceptedAt: Date | null; expiresAt: Date | null }, now: Date,
): "valid" | "used" | "expired" {
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) return "expired";
  return "valid";
}

export function assertInviteUsable(invite: { acceptedAt: Date | null; expiresAt: Date | null }, now: Date): void {
  const s = inviteState(invite, now);
  if (s === "used") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has already been used" });
  if (s === "expired") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
