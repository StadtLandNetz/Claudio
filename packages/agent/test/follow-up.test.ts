import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore, recheckFindingTool } from "@claudio/browser";
import { ReviewRequestSchema, budgetProfile, type FollowUpContext } from "@claudio/core";
import { buildReviewPrompt } from "../src/prompts.js";
import { completeFollowUp } from "../src/runner.js";

const finding = (id: string, title: string, severity: "blocker" | "major" | "minor" = "major") => ({
  id,
  category: "acceptance" as const,
  severity,
  title,
  description: `${title} beschrieben`,
  steps: ["öffnen", "speichern"],
  evidenceIds: ["E1"],
  createdAt: "2026-10-20T10:00:00.000Z",
  rating: "proposed" as const,
  comment: null,
});

const ctx: FollowUpContext = {
  reviewId: 5,
  headSha: "abc1234def",
  changedFiles: ["src/routes/trips/+page.svelte"],
  summary: "Zwei Probleme.",
  criteria: [
    { criterion: "Fahrt lässt sich bearbeiten", status: "failed", notes: "Speichern ging nicht" },
    { criterion: "Liste zeigt die Fahrt", status: "passed", notes: "" },
  ],
  findings: [finding("F1", "Speichern verliert Änderungen", "blocker"), finding("F2", "Button falsch beschriftet", "minor")],
  dismissed: ["Datum im US-Format"],
};

describe("re-review prompt", () => {
  const base = {
    runId: "r2",
    pr: { owner: "o", repo: "r", number: 1, title: "T", body: "", url: "u", headRef: "f", headSha: "s", baseRef: "main", draft: false, files: [], issues: [] },
    config: null,
    repoDir: null,
    profile: budgetProfile("quick"),
    driverPrefix: "",
  };
  it("lists the earlier findings, the changes and the re-review procedure", () => {
    const p = buildReviewPrompt({ ...base, request: ReviewRequestSchema.parse({ repo: "o/r", pr: 1, instanceUrl: "https://x.test", followUpOf: 5 }), followUp: ctx });
    expect(p).toContain("# Re-review of review #5");
    expect(p).toContain("- src/routes/trips/+page.svelte");
    expect(p).toContain("## F1 [blocker] Speichern verliert Änderungen");
    expect(p).toContain("- Datum im US-Format");
    expect(p).toContain("# Procedure (re-review)");
    expect(p).toContain("recheck_finding");
    expect(p).not.toContain("Delegate to ac-verifier");
  });
  it("uses confirmed criteria verbatim", () => {
    const p = buildReviewPrompt({
      ...base,
      profile: budgetProfile("standard"),
      request: ReviewRequestSchema.parse({ repo: "o/r", pr: 1, instanceUrl: "https://x.test", budget: "standard", criteria: ["Eine Fahrt lässt sich speichern", "Die Liste aktualisiert sich"] }),
    });
    expect(p).toContain("# Acceptance criteria (confirmed by a person)");
    expect(p).toContain("1. Eine Fahrt lässt sich speichern\n2. Die Liste aktualisiert sich");
    expect(p).toContain("Take the confirmed acceptance criteria above as they are");
    expect(p).not.toContain("Extract the acceptance criteria from the issue(s)");
  });
});

describe("re-review records", () => {
  it("re-records still open findings, carries over the rest and keeps untested criteria", async () => {
    const store = new RunStore(mkdtempSync(join(tmpdir(), "claudio-followup-")));
    const tool = recheckFindingTool(store, { reviewId: 5, findings: ctx.findings.map(({ rating: _r, comment: _c, ...f }) => f) });
    expect(await tool.handler({ findingId: "F9", status: "fixed", notes: "", evidenceIds: [] })).toMatch(/no open finding F9/);
    // first still open, then fixed after all: the re-recorded finding goes away again
    expect(await tool.handler({ findingId: "F1", status: "still_open", notes: "", evidenceIds: ["E2"] })).toMatch(/recorded again as F1/);
    expect(store.findings()).toHaveLength(1);
    await tool.handler({ findingId: "F1", status: "fixed", notes: "geht jetzt", evidenceIds: ["E3"] });
    expect(store.findings()).toHaveLength(0);
    store.recordAcResult({ criterion: "Fahrt lässt sich bearbeiten", status: "passed", notes: "jetzt ok", evidenceIds: ["E3"] });

    const out = completeFollowUp(store, ctx);
    expect(out.rechecks.map((r) => [r.findingId, r.status])).toEqual([
      ["F1", "fixed"],
      ["F2", "not_rechecked"],
    ]);
    const carried = store.findings();
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ title: "Button falsch beschriftet", previous: { reviewId: 5, findingId: "F2", status: "not_rechecked" } });
    expect(carried[0]).not.toHaveProperty("rating");
    const acs = store.acResults();
    expect(acs.find((a) => a.criterion === "Fahrt lässt sich bearbeiten")).toMatchObject({ status: "passed" });
    expect(acs.find((a) => a.criterion === "Liste zeigt die Fahrt")).toMatchObject({ status: "passed", carriedFrom: 5 });
    expect(out.changedFiles).toEqual(["src/routes/trips/+page.svelte"]);
  });

  it("does not bring back earlier criteria a person dropped", () => {
    const store = new RunStore(mkdtempSync(join(tmpdir(), "claudio-followup-")));
    completeFollowUp(store, { ...ctx, findings: [], changedFiles: null }, ["Fahrt lässt sich bearbeiten", "Neues Kriterium"]);
    expect(store.acResults().map((a) => a.criterion)).toEqual(["Fahrt lässt sich bearbeiten"]);
    expect(completeFollowUp(store, { ...ctx, findings: [], changedFiles: null }).changedFiles).toBeNull();
  });
});
