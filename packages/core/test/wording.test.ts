import { describe, expect, it } from "vitest";
import { ReviewReportSchema, renderCommitStatus, renderMarkdown, renderPrComment, type ReviewReport } from "../src/index.js";

// Texts Claudio posts to the pull request. Snapshots guard the GitHub wording
// while the texts become provider-aware; a change here must be deliberate.
function report(language: "de" | "en"): ReviewReport {
  return ReviewReportSchema.parse({
    runId: "review-pr17-x",
    status: "completed",
    request: { repo: "o/r", pr: 17, instanceUrl: "https://pr-17.example.test", language },
    pr: { number: 17, title: "Neue Fahrt", url: "https://github.com/o/r/pull/17", headRef: "feature/16-neue-fahrt", baseRef: "main", author: "dev", headSha: "abc1234" },
    issues: [{ number: 16, title: "Disponent legt Fahrt an", url: "https://github.com/o/r/issues/16" }],
    summary: "Fast fertig.\n\nAffected areas:\n- Fahrten",
    acceptanceCriteria: [{ criterion: "Fahrt speichern", status: "failed", notes: "500", evidenceIds: ["E1"], createdAt: "t" }],
    findings: [
      { id: "F1", category: "acceptance", severity: "major", title: "Speichern schlägt fehl", description: "d", steps: ["a"], evidenceIds: ["E1"], createdAt: "t" },
      { id: "F2", category: "ux", severity: "minor", title: "Button zu klein", description: "d", steps: [], evidenceIds: [], createdAt: "t" },
    ],
    evidence: [{ id: "E1", kind: "screenshot", label: "fail", path: "evidence/E1.png", createdAt: "t" }],
    cost: { usd: 2.5, inputTokens: 10, outputTokens: 5, turns: 3, durationMs: 4000, browserSteps: 12 },
    followUp: { reviewId: 3, headSha: "0001111", changedFiles: ["src/a.ts"], rechecks: [{ findingId: "F9", title: "Alt", severity: "major", status: "fixed", notes: "", evidenceIds: [] }] },
    createdAt: "t",
  });
}

describe("posted wording", () => {
  for (const language of ["de", "en"] as const) {
    it(`markdown report and PR comment (${language})`, () => {
      const r = report(language);
      const opts = { notes: [{ findingId: "F1", status: "confirmed" as const, comment: "Stimmt", by: "lars" }], tests: [{ name: "Login", outcome: "passed" as const }] };
      expect(renderMarkdown(r, "detailed", opts)).toMatchSnapshot();
      expect(renderPrComment(r, "https://claudio.example.test/reviews/9", opts)).toMatchSnapshot();
    });

    it(`commit status (${language})`, () => {
      expect([
        renderCommitStatus(language, { kind: "pending" }),
        renderCommitStatus(language, { kind: "testsRunning", pendingTests: 2 }),
        renderCommitStatus(language, { kind: "done", verdict: "request_changes", acPassed: 1, acTotal: 2, blocking: 1, tests: { passed: 1, total: 1 } }),
        renderCommitStatus(language, { kind: "failed", verdict: "inconclusive", reason: "Budget" }),
      ]).toMatchSnapshot();
    });
  }
});

describe("GitLab wording", () => {
  it("names merge requests the GitLab way", () => {
    const r = report("en");
    const gitlab = { ...r, request: { ...r.request, provider: "gitlab" as const } };
    expect(renderMarkdown(gitlab, "normal").split("\n")[0]).toBe("# Claudio Review: MR !17 Neue Fahrt");
    expect(renderCommitStatus("de", { kind: "pending" }, "gitlab")).toBe("Claudio prüft den Merge Request …");
    expect(renderCommitStatus("en", { kind: "pending" }, "gitlab")).toBe("Claudio is reviewing the merge request …");
    // The marker Claudio finds its own earlier reviews by stays the same.
    expect(renderPrComment(gitlab)).toContain("Claudio Review");
  });
});
