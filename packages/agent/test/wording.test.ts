import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnalysisRequestSchema, ReviewRequestSchema, budgetProfile } from "@claudio/core";
import type { PullRequestContext } from "@claudio/forge";
import { buildAnalysisPrompt, buildCriteriaPrompt, buildReviewPrompt } from "../src/index.js";

// What the agent is told about a pull request. Snapshots guard the GitHub wording
// while the prompts become provider-aware; a change here must be deliberate.
const pr = JSON.parse(readFileSync(new URL("../../../apps/demo-target/fixtures/pr-context.json", import.meta.url), "utf8")) as PullRequestContext;

describe("prompt wording", () => {
  it("review prompt with a re-review whose changed files are unknown", () => {
    const request = ReviewRequestSchema.parse({ repo: "vanderlars/dispo-demo", pr: 17, instanceUrl: "http://127.0.0.1:4310" });
    const prompt = buildReviewPrompt({
      runId: "review-pr17-test",
      request,
      pr,
      config: null,
      repoDir: "/tmp/checkout",
      profile: budgetProfile("standard"),
      driverPrefix: "# Browser",
      followUp: { reviewId: 3, headSha: "abc1234", changedFiles: null, summary: "Vorher.", criteria: [], findings: [], dismissed: [] },
    });
    expect(prompt).toMatchSnapshot();
  });

  it("criteria prompt", () => {
    expect(buildCriteriaPrompt({ pr, language: "de", previous: ["Eine Fahrt lässt sich speichern"] })).toMatchSnapshot();
  });

  it("analysis prompt with a truncated change list", () => {
    const request = AnalysisRequestSchema.parse({ repo: "vanderlars/dispo-demo", instanceUrl: "http://127.0.0.1:4310" });
    const prompt = buildAnalysisPrompt({
      runId: "analysis-test",
      request,
      config: null,
      repoDir: null,
      branch: "main",
      commitSha: "def5678",
      knowledgeDir: "/tmp/knowledge",
      previous: { commitSha: "abc1234", branch: "main", analyzedAt: "2026-10-01T00:00:00Z", docs: [] },
      changedSince: { files: [{ filename: "src/server.mjs", status: "modified" }], totalCommits: 4, truncated: true },
      profile: budgetProfile("standard"),
      driverPrefix: "# Browser",
    });
    expect(prompt).toMatchSnapshot();
  });
});

describe("GitLab prompt wording", () => {
  it("calls the change a merge request with its ! reference", () => {
    const request = ReviewRequestSchema.parse({ repo: "slw/apps/dispo", provider: "gitlab", pr: 17, instanceUrl: "http://127.0.0.1:4310" });
    const prompt = buildReviewPrompt({
      runId: "r",
      request,
      pr: { ...pr, provider: "gitlab", draft: true },
      config: null,
      repoDir: null,
      profile: budgetProfile("quick"),
      driverPrefix: "",
      followUp: { reviewId: 3, changedFiles: null, summary: "", criteria: [], findings: [], dismissed: [] },
    });
    expect(prompt).toContain("# Merge request !17: ");
    expect(prompt).toContain("Draft MR");
    expect(prompt).toContain("GitLab could not tell which files changed");
    expect(buildCriteriaPrompt({ pr: { ...pr, provider: "gitlab" }, language: "en" })).toContain("# Merge request !17: ");
  });
});
