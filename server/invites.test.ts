import { describe, it, expect } from "vitest";
import { inviteState, assertInviteUsable, generateToken } from "./invites";

const now = new Date("2026-06-30T00:00:00Z");
describe("inviteState", () => {
  it("valid when unused and unexpired", () =>
    expect(inviteState({ acceptedAt: null, expiresAt: null }, now)).toBe("valid"));
  it("used when acceptedAt set", () =>
    expect(inviteState({ acceptedAt: now, expiresAt: null }, now)).toBe("used"));
  it("expired when past expiresAt", () =>
    expect(inviteState({ acceptedAt: null, expiresAt: new Date("2026-06-29T00:00:00Z") }, now)).toBe("expired"));
});
describe("assertInviteUsable", () => {
  it("throws on used", () => expect(() => assertInviteUsable({ acceptedAt: now, expiresAt: null }, now)).toThrow(/used/i));
  it("throws on expired", () => expect(() => assertInviteUsable({ acceptedAt: null, expiresAt: new Date(0) }, now)).toThrow(/expired/i));
  it("passes on valid", () => expect(() => assertInviteUsable({ acceptedAt: null, expiresAt: null }, now)).not.toThrow());
});
describe("generateToken", () => {
  it("produces a long url-safe string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(20);
  });
});
