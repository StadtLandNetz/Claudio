import { describe, expect, it } from "vitest";
import { renderCommitStatus } from "../src/report.js";

describe("renderCommitStatus", () => {
  const done = { kind: "done", verdict: "request_changes", acPassed: 3, acTotal: 5, blocking: 2, tests: { passed: 1, total: 2 } } as const;

  it("follows the review's language", () => {
    expect(renderCommitStatus("de", done)).toBe("Änderungen nötig: 3/5 Kriterien, 2 blockierend, Tests 1/2");
    expect(renderCommitStatus("en", done)).toBe("Changes needed: 3/5 criteria, 2 blocking, Tests 1/2");
    expect(renderCommitStatus("en", { kind: "pending" })).toBe("Claudio is reviewing the pull request …");
    expect(renderCommitStatus("de", { kind: "testsRunning", pendingTests: 2 })).toBe("Review fertig, 2 Regressionstest(s) laufen noch");
    expect(renderCommitStatus("en", { kind: "failed", verdict: "inconclusive", reason: "failed" })).toBe("Review incomplete: failed");
  });

  it("leaves out tests when none ran", () => {
    expect(renderCommitStatus("en", { ...done, tests: undefined, verdict: "approve" })).toBe("Approval recommended: 3/5 criteria, 2 blocking");
  });
});
