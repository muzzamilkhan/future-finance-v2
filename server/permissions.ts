import { TRPCError } from "@trpc/server";

export type Capability = "editItems" | "editOverrides" | "editHolidays" | "updateBalance";
export type MembershipPerms = {
  role: "OWNER" | "MEMBER";
  canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
};

const FLAG: Record<Capability, keyof MembershipPerms> = {
  editItems: "canEditItems", editOverrides: "canEditOverrides",
  editHolidays: "canEditHolidays", updateBalance: "canUpdateBalance",
};

export function hasCapability(m: MembershipPerms, cap: Capability): boolean {
  if (m.role === "OWNER") return true;
  return m[FLAG[cap]] === true;
}

export function assertCan(m: MembershipPerms, cap: Capability): void {
  if (!hasCapability(m, cap)) throw new TRPCError({ code: "FORBIDDEN" });
}
