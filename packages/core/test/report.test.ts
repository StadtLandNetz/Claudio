import { describe, expect, it } from "vitest";
import { ReviewReportSchema, blockingFindings, renderMarkdown, renderPrComment, verdict, withTests, type ReviewReport } from "../src/index.js";

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return ReviewReportSchema.parse({
    runId: "review-pr1-x",
    status: "completed",
    request: { repo: "o/r", pr: 1, instanceUrl: "https://pr-1.example.test", strictness: "normal", verbosity: "normal", language: "de" },
    pr: { number: 1, title: "Fahrt anlegen", url: "https://github.com/o/r/pull/1", headRef: "f", baseRef: "main" },
    issues: [],
    summary: "Alles gut.\n\nAffected areas:\n- Fahrten",
    acceptanceCriteria: [{ criterion: "Fahrt speichern", status: "passed", notes: "", evidenceIds: [], createdAt: "t" }],
    findings: [
      { id: "F1", category: "ux", severity: "minor", title: "Button zu klein", description: "d", steps: [], evidenceIds: [], createdAt: "t" },
      { id: "F2", category: "acceptance", severity: "major", title: "Speichern schlägt fehl", description: "d", steps: ["a"], evidenceIds: ["E1"], createdAt: "t" },
      { id: "F3", category: "ui", severity: "suggestion", title: "Farbe", description: "d", steps: [], evidenceIds: [], createdAt: "t" },
    ],
    evidence: [{ id: "E1", kind: "screenshot", label: "fail", path: "evidence/E1.png", createdAt: "t" }],
    cost: { usd: 1.23, inputTokens: 10, outputTokens: 5, turns: 3, durationMs: 4000, browserSteps: 12 },
    createdAt: "t",
    ...overrides,
  });
}

describe("strictness", () => {
  it("normal blocks major and above", () => {
    expect(blockingFindings(report()).map((f) => f.id)).toEqual(["F2"]);
  });
  it("strict also blocks minor", () => {
    expect(blockingFindings(report(), "strict").map((f) => f.id)).toEqual(["F2", "F1"]);
  });
  it("lenient blocks only blockers", () => {
    expect(blockingFindings(report(), "lenient")).toEqual([]);
    expect(verdict(report(), "lenient")).toBe("approve");
    expect(verdict(report(), "normal")).toBe("request_changes");
  });
  it("ignores dismissed findings", () => {
    expect(blockingFindings(report(), "normal", ["F2"])).toEqual([]);
    expect(verdict(report(), "normal", ["F2"])).toBe("approve");
    expect(verdict(report(), "strict", ["F2"])).toBe("request_changes");
  });
  it("is inconclusive when the run did not complete", () => {
    expect(verdict(report({ status: "budget_exceeded" }))).toBe("inconclusive");
  });
});

describe("rendering", () => {
  it("tldr lists only blocking titles", () => {
    const md = renderMarkdown(report(), "tldr");
    expect(md).toContain("Speichern schlägt fehl");
    expect(md).not.toContain("Button zu klein");
    expect(md).not.toContain("Kosten");
  });
  it("detailed includes steps, evidence and cost", () => {
    const md = renderMarkdown(report(), "detailed");
    expect(md).toContain("Button zu klein");
    expect(md).toContain("evidence/E1.png");
    expect(md).toContain("## Kosten");
    expect(md).toContain("Fahrten");
  });
  it("PR comment carries verdict and run id", () => {
    const c = renderPrComment(report(), "https://claudio.example/runs/1");
    expect(c).toContain("Änderungen nötig");
    expect(c).toContain("review-pr1-x");
    expect(c).toContain("https://claudio.example/runs/1");
  });
});

describe("rendering with human adjustments", () => {
  it("leaves dismissed findings out of the Markdown report and the PR comment", () => {
    const md = renderMarkdown(report(), "normal", { dismissedIds: ["F2"] });
    expect(md).not.toContain("Speichern schlägt fehl");
    expect(md).toContain("Button zu klein");
    expect(md).toContain("verworfene Findings");
    const comment = renderPrComment(report(), "https://claudio.example.test/reviews/1", { dismissedIds: ["F2"] });
    expect(comment).toContain("Keine blockierenden Findings");
    expect(comment).toContain("https://claudio.example.test/reviews/1");
  });
  it("applies a stricter level chosen afterwards", () => {
    expect(renderPrComment(report(), undefined, { strictness: "strict" })).toContain("Button zu klein");
  });
});

describe("regression tests in the verdict", () => {
  it("a failed test turns an approval into changes requested and shows in the comment", () => {
    expect(withTests("approve", [{ name: "Fahrt anlegen", outcome: "failed" }])).toBe("request_changes");
    expect(withTests("approve", [{ name: "Fahrt anlegen", outcome: "passed" }])).toBe("approve");
    expect(withTests("inconclusive", [{ name: "x", outcome: "failed" }])).toBe("inconclusive");
    const c = renderPrComment(report(), undefined, { dismissedIds: ["F2"], tests: [{ name: "Fahrt anlegen", outcome: "failed" }, { name: "Suche", outcome: "passed" }] });
    expect(c).toContain("Änderungen nötig");
    expect(c).toContain("Regressionstests: 1/2 bestanden. Fehlgeschlagen: Fahrt anlegen.");
  });
});
