import { describe, expect, it } from "vitest";
import { ReviewRequestSchema, budgetProfile, type Impact } from "@claudio/core";
import { buildReviewPrompt, extractAffectedAreas, renderImpact } from "../src/prompts.js";
import { createBrowserGuard } from "../src/hooks.js";
import { modelEnv } from "../src/runner.js";

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

describe("computed impact", () => {
  const impact: Impact = {
    framework: "sveltekit",
    routes: [
      { pattern: "/trips/[id]", kind: "page", direct: true, via: ["src/routes/trips/[id]/+page.svelte"] },
      { pattern: "/admin", kind: "layout", direct: false, via: ["src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts", "src/lib/d.ts", "src/routes/admin/+layout.svelte"] },
    ],
    global: [],
    unmapped: ["scripts/seed.ts"],
    stats: { files: 5, imports: 4, ignored: 0, ms: 1 },
  };
  const input = (tier: "quick" | "standard", i: Impact | null) => ({
    runId: "r1",
    request: ReviewRequestSchema.parse({ repo: "o/r", pr: 1, instanceUrl: "https://pr-1.example.test", budget: tier }),
    pr: { owner: "o", repo: "r", number: 1, title: "T", body: "", url: "u", headRef: "f", headSha: "s", baseRef: "main", draft: false, files: [], issues: [] },
    config: null,
    repoDir: "/tmp/repo",
    profile: budgetProfile(tier),
    driverPrefix: "",
    impact: i,
  });

  it("lists the routes with short chains and lets the model rank them", () => {
    const p = buildReviewPrompt(input("standard", impact));
    expect(p).toContain("# Computed impact (import graph)");
    expect(p).toContain("- /trips/[id] (page)");
    expect(p).toContain("- /admin/** (layout) via src/lib/a.ts → … → src/lib/d.ts → src/routes/admin/+layout.svelte");
    expect(p).toContain("- scripts/seed.ts");
    expect(p).toContain("do not delegate this to the impact-analyst");
    expect(p).not.toContain("You may delegate the code reading to the impact-analyst");
  });
  it("keeps the impact-analyst for apps the graph cannot map", () => {
    const p = buildReviewPrompt(input("standard", { ...impact, framework: "unknown", routes: [] }));
    expect(p).toContain("could not map the changed files to routes");
    expect(p).toContain("delegate this to the impact-analyst subagent");
  });
  it("renders a global change", () => {
    expect(renderImpact({ ...impact, global: [{ file: "src/lib/s.ts", via: ["src/lib/s.ts", "src/hooks.server.ts"] }] })).toContain("- src/lib/s.ts → src/hooks.server.ts");
  });
});

describe("model environment", () => {
  const server = { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-server", CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "https://proxy" };
  it("uses only the repository key and drops every other credential", () => {
    const env = modelEnv(server, "sk-ant-repo");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-repo");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });
  it("leaves the environment alone without a repository key (CLI)", () => {
    expect(modelEnv(server, undefined)).toBe(server);
  });
});
