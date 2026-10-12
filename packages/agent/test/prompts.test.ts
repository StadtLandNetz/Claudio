import { describe, expect, it } from "vitest";
import { ReviewRequestSchema, budgetProfile } from "@claudio/core";
import { buildReviewPrompt, extractAffectedAreas } from "../src/prompts.js";
import { createBrowserGuard } from "../src/hooks.js";

describe("extractAffectedAreas", () => {
  it("reads the bullet list under the heading", () => {
    const s = "Fazit.\n\nAffected areas:\n- Fahrten anlegen\n* Tourenplanung\n\nNicht getestet: nichts";
    expect(extractAffectedAreas(s)).toEqual(["Fahrten anlegen", "Tourenplanung"]);
  });
  it("returns empty when missing", () => {
    expect(extractAffectedAreas("nothing")).toEqual([]);
  });
});

describe("browser guard", () => {
  const input = (tool: string, url?: string) => ({
    hook_event_name: "PreToolUse" as const,
    tool_name: tool,
    tool_input: url ? { url } : {},
    tool_use_id: "t",
    session_id: "s",
    transcript_path: "",
    cwd: "",
  });
  it("denies navigation outside the instance host", async () => {
    const g = createBrowserGuard({ allowedHosts: ["pr-1.example.test"], maxBrowserSteps: 10 });
    const hook = g.hooks[0]!.hooks[0]!;
    const ok = await hook(input("mcp__playwright__browser_navigate", "https://pr-1.example.test/fahrten"), "t", { signal: new AbortController().signal });
    expect(ok).toEqual({});
    const sub = await hook(input("mcp__playwright__browser_navigate", "https://api.pr-1.example.test/x"), "t", { signal: new AbortController().signal });
    expect(sub).toEqual({});
    const bad = await hook(input("mcp__playwright__browser_navigate", "https://evil.test/"), "t", { signal: new AbortController().signal });
    expect((bad as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe("deny");
    const js = await hook(input("mcp__playwright__browser_navigate", "javascript:alert(1)"), "t", { signal: new AbortController().signal });
    expect((js as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe("deny");
  });
  it("counts steps and denies past the budget, ignoring claudio tools", async () => {
    const g = createBrowserGuard({ allowedHosts: ["h"], maxBrowserSteps: 2 });
    const hook = g.hooks[0]!.hooks[0]!;
    const sig = { signal: new AbortController().signal };
    await hook(input("mcp__claudio__note"), "t", sig);
    await hook(input("mcp__playwright__browser_snapshot"), "t", sig);
    await hook(input("mcp__playwright__browser_click"), "t", sig);
    expect(g.steps()).toBe(2);
    const over = await hook(input("mcp__playwright__browser_click"), "t", sig);
    expect((over as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe("deny");
  });
});

describe("review procedure", () => {
  const input = (tier: "quick" | "standard") => ({
    runId: "r1",
    request: ReviewRequestSchema.parse({ repo: "o/r", pr: 1, instanceUrl: "https://pr-1.example.test", budget: tier }),
    pr: { owner: "o", repo: "r", number: 1, title: "T", body: "", url: "u", headRef: "f", headSha: "s", baseRef: "main", draft: false, files: [], issues: [] },
    config: null,
    repoDir: null,
    profile: budgetProfile(tier),
    driverPrefix: "",
  });
  it("keeps one agent on the quick budget", () => {
    const p = buildReviewPrompt(input("quick"));
    expect(p).not.toContain("Delegate to ac-verifier");
    expect(p).toContain("Work the todo list");
  });
  it("delegates checks one after the other on the standard budget", () => {
    const p = buildReviewPrompt(input("standard"));
    expect(p).toContain("Delegate to ac-verifier");
    expect(p).toContain("Delegate to regression-tester");
    expect(p).toContain("never in parallel");
  });
});
