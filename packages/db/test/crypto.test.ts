import { describe, expect, it } from "vitest";
import { decrypt, encrypt, secretKey } from "../src/crypto.js";
import { roleEnvNames, toRepoConfig } from "../src/repo-config.js";
import type { RepoRole } from "../src/schema.js";

const key = secretKey("test-key-with-enough-length");

describe("crypto", () => {
  it("round-trips and uses a fresh IV per call", () => {
    const a = encrypt("geheim", key);
    const b = encrypt("geheim", key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe("geheim");
  });
  it("rejects tampered ciphertext and wrong keys", () => {
    const token = encrypt("geheim", key);
    const parts = token.split(".");
    parts[3] = Buffer.from("anders").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
    expect(() => decrypt(token, secretKey("another-key-with-length"))).toThrow();
  });
  it("refuses short keys", () => {
    expect(() => secretKey("short")).toThrow(/CLAUDIO_SECRET_KEY/);
  });
});

describe("toRepoConfig", () => {
  const role = (name: string, extra: Partial<RepoRole> = {}): RepoRole => ({
    id: 1,
    repoId: 1,
    name,
    description: null,
    usernameEnc: encrypt(`${name}@example.test`, key),
    passwordEnc: encrypt(`${name}-pw`, key),
    loginPath: "/login",
    successUrlContains: null,
    recipe: null,
    createdAt: new Date(),
    ...extra,
  });

  it("maps roles to env var names and keeps credentials out of the config", () => {
    const { config, roleEnv } = toRepoConfig(
      { fullName: "o/r", notes: "Hinweis", extraAllowedHosts: ["auth.example.test"] },
      [role("dispatcher", { successUrlContains: "/dashboard" }), role("super-admin")],
      (v) => decrypt(v, key),
    );
    expect(config.repo).toBe("o/r");
    expect(config.notes).toBe("Hinweis");
    expect(config.extraAllowedHosts).toEqual(["auth.example.test"]);
    expect(config.roles["dispatcher"]).toMatchObject({ usernameEnv: "CLAUDIO_ROLE_DISPATCHER_USER", successUrlContains: "/dashboard" });
    expect(roleEnvNames("super-admin").passwordEnv).toBe("CLAUDIO_ROLE_SUPER_ADMIN_PASSWORD");
    expect(roleEnv).toEqual({
      CLAUDIO_ROLE_DISPATCHER_USER: "dispatcher@example.test",
      CLAUDIO_ROLE_DISPATCHER_PASSWORD: "dispatcher-pw",
      CLAUDIO_ROLE_SUPER_ADMIN_USER: "super-admin@example.test",
      CLAUDIO_ROLE_SUPER_ADMIN_PASSWORD: "super-admin-pw",
    });
    expect(JSON.stringify(config)).not.toContain("-pw");
  });
});
