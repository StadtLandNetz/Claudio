import { describe, expect, it } from "vitest";
import { RepoConfigSchema, resolveCredentials, budgetProfile } from "../src/index.js";

describe("config", () => {
  it("parses roles with defaults", () => {
    const cfg = RepoConfigSchema.parse({ repo: "o/r", roles: { admin: { usernameEnv: "U", passwordEnv: "P" } } });
    expect(cfg.roles.admin!.loginPath).toBe("/login");
    expect(cfg.extraAllowedHosts).toEqual([]);
  });
  it("resolves credentials only when both vars exist", () => {
    const role = RepoConfigSchema.parse({ repo: "o/r", roles: { a: { usernameEnv: "U", passwordEnv: "P" } } }).roles.a!;
    expect(resolveCredentials(role, { U: "x" })).toBeNull();
    expect(resolveCredentials(role, { U: "x", P: "y" })).toEqual({ username: "x", password: "y" });
  });
  it("applies a model override to the orchestrator only", () => {
    const p = budgetProfile("standard", "claude-fable-5-1");
    expect(p.orchestratorModel).toBe("claude-fable-5-1");
    expect(p.workerModel).toBe("claude-sonnet-5-5");
  });
});
