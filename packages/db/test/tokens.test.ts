import { beforeAll, describe, expect, it } from "vitest";
import { encrypt } from "../src/crypto.js";
import { linkDecision } from "../src/queries.js";
import { needsRefresh, renewedElsewhere } from "../src/tokens.js";

beforeAll(() => {
  process.env.CLAUDIO_SECRET_KEY ??= "test-key-with-enough-length";
});

const MIN = 60_000;

describe("token renewal", () => {
  it("renews only tokens that expire within five minutes", () => {
    const now = Date.now();
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh(new Date(now + 10 * MIN), now)).toBe(false);
    expect(needsRefresh(new Date(now + 4 * MIN), now)).toBe(true);
    expect(needsRefresh(new Date(now - MIN), now)).toBe(true);
  });

  it("uses the token another process stored after the refresh token changed", () => {
    const before = { refreshTokenEnc: encrypt("refresh-1") };
    const fresh = { accessTokenEnc: encrypt("access-2"), refreshTokenEnc: encrypt("refresh-2"), tokenExpiresAt: new Date(Date.now() + 2 * 60 * MIN) };
    expect(renewedElsewhere(fresh, before)).toBe("access-2");
  });

  it("gives up when nobody renewed or the stored token is stale too", () => {
    const before = { refreshTokenEnc: encrypt("refresh-1") };
    expect(renewedElsewhere(undefined, before)).toBeNull();
    expect(renewedElsewhere({ accessTokenEnc: encrypt("access-1"), refreshTokenEnc: before.refreshTokenEnc, tokenExpiresAt: new Date() }, before)).toBeNull();
    expect(renewedElsewhere({ accessTokenEnc: encrypt("access-2"), refreshTokenEnc: encrypt("refresh-2"), tokenExpiresAt: new Date(Date.now() + MIN) }, before)).toBeNull();
  });
});

describe("connecting accounts", () => {
  it("connects a new account, renews a connected one and refuses another person's", () => {
    expect(linkDecision(undefined, 7)).toBe("new");
    expect(linkDecision({ userId: 7 }, 7)).toBe("refresh");
    expect(linkDecision({ userId: 8 }, 7)).toBe("taken");
  });
});
