import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { analysisProfile, AnalysisRequestSchema, type KnowledgeBase } from "@claudio/core";
import { writeKnowledgeTool } from "@claudio/browser";
import { buildAnalysisPrompt } from "../src/analysis-prompt.js";
import { readKnowledgeFiles } from "../src/analysis-runner.js";
import { KNOWLEDGE_INLINE_LIMIT, renderKnowledgeSection } from "../src/prompts.js";
import { writeKnowledgeFiles } from "../src/runner.js";

const tmp = mkdtempSync(join(tmpdir(), "claudio-knowledge-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base: KnowledgeBase = {
  commitSha: "abc1234def",
  branch: "main",
  analyzedAt: "2026-10-01T10:00:00.000Z",
  docs: [
    { name: "routes", content: "- `/trips` → src/routes/trips/+page.svelte" },
    { name: "app-map", content: "## Fahrten (/trips)" },
  ],
};

const prompt = (overrides: Partial<Parameters<typeof buildAnalysisPrompt>[0]> = {}) =>
  buildAnalysisPrompt({
    runId: "analysis-x",
    request: AnalysisRequestSchema.parse({ repo: "o/r", instanceUrl: "https://staging.example.test", roles: ["dispatcher"] }),
    config: { repo: "o/r", roles: { dispatcher: { usernameEnv: "U", passwordEnv: "P", loginPath: "/login", description: "Disponent" } }, extraAllowedHosts: [] },
    repoDir: "/tmp/repo",
    branch: "main",
    commitSha: "fff0000",
    knowledgeDir: "/tmp/run/knowledge",
    previous: null,
    changedSince: null,
    profile: analysisProfile("quick"),
    driverPrefix: "",
    ...overrides,
  });

describe("analysis prompt", () => {
  it("delegates the code scan and names roles for a first analysis", () => {
    const p = prompt();
    expect(p).toContain("code-scanner subagent to map /tmp/repo");
    expect(p).toContain("dispatcher (Disponent)");
    expect(p).not.toContain("Changes since the previous analysis");
  });
  it("lists changed files when updating", () => {
    const p = prompt({ previous: base, changedSince: { files: [{ filename: "src/routes/trips/+page.svelte", status: "modified" }], totalCommits: 3, truncated: false } });
    expect(p).toContain("commit abc1234 on main");
    expect(p).toContain("- modified src/routes/trips/+page.svelte");
    expect(p).toContain("Update it rather than starting over");
  });
  it("falls back to the app when there is no checkout", () => {
    expect(prompt({ repoDir: null })).toContain("No checkout is available");
  });
  it("proposes tests for flows without one when asked to", () => {
    const p = prompt({ existingTests: ["Fahrt anlegen"], maxProposals: 5 });
    expect(p).toContain("# Regression tests");
    expect(p).toContain("- Fahrt anlegen");
    expect(p).toContain("5. Propose regression tests with propose_test, most important first, up to 5");
    expect(p).toContain("8. Finish with a short summary");
    expect(prompt({ existingTests: [], maxProposals: 5 })).toContain("no regression tests yet");
  });
  it("proposes no tests by default", () => {
    const p = prompt();
    expect(p).not.toContain("propose_test");
    expect(p).toContain("5. Write notes.md");
    expect(p).toContain("7. Finish with a short summary");
  });
});

describe("knowledge files", () => {
  it("round-trips documents in canonical order", () => {
    const dir = writeKnowledgeFiles(join(tmp, "a"), base);
    expect(readKnowledgeFiles(dir).map((d) => d.name)).toEqual(["routes", "app-map"]);
  });
  it("write_knowledge replaces and appends", async () => {
    const dir = join(tmp, "b");
    const tool = writeKnowledgeTool(dir);
    await tool.handler({ doc: "app-map", content: "## A", mode: "replace" });
    await tool.handler({ doc: "app-map", content: "## B", mode: "append" });
    expect(readFileSync(join(dir, "app-map.md"), "utf8")).toBe("## A\n\n## B\n");
    await tool.handler({ doc: "app-map", content: "## C", mode: "replace" });
    expect(readFileSync(join(dir, "app-map.md"), "utf8")).toBe("## C\n");
  });
  it("review section inlines small route index and app map", () => {
    const s = renderKnowledgeSection("/run/knowledge", base, "review");
    expect(s).toContain("## routes.md");
    expect(s).toContain("src/routes/trips/+page.svelte");
    expect(s).toContain("/run/knowledge/app-map.md");
  });
  it("review section only references large knowledge bases", () => {
    const big = { ...base, docs: [{ name: "app-map" as const, content: "x".repeat(KNOWLEDGE_INLINE_LIMIT + 1) }] };
    const s = renderKnowledgeSection("/run/knowledge", big, "review");
    expect(s).not.toContain("## app-map.md");
    expect(s).toContain("Read routes.md");
  });
});
