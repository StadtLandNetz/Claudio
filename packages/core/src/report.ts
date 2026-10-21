import type { Finding, Language, ReviewReport, Severity, Strictness, Verbosity } from "./schemas.js";

export const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};

/** Minimum severity that blocks a merge under a strictness level. */
export const STRICTNESS_THRESHOLD: Record<Strictness, Severity> = {
  lenient: "blocker",
  normal: "major",
  strict: "minor",
};

/** What the verdict needs of a finding: lists load only this much of a report. */
export type FindingLike = Pick<Finding, "id" | "severity">;
/** What the verdict needs of a report. A full ReviewReport satisfies it, so does a digest from the database. */
export type ReportLike = {
  status: ReviewReport["status"];
  request: { strictness: Strictness };
  acceptanceCriteria: { status: ReviewReport["acceptanceCriteria"][number]["status"] }[];
  findings: FindingLike[];
};

export function isBlocking(finding: FindingLike, strictness: Strictness): boolean {
  return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[STRICTNESS_THRESHOLD[strictness]];
}

/** Findings that block a merge. Findings a person dismissed (by id) never block. */
export function blockingFindings<F extends FindingLike>(
  report: { findings: F[]; request: { strictness: Strictness } },
  strictness: Strictness = report.request.strictness,
  dismissedIds: readonly string[] = [],
): F[] {
  return sortBySeverity(report.findings.filter((f) => !dismissedIds.includes(f.id) && isBlocking(f, strictness)));
}

export function sortBySeverity<F extends FindingLike>(findings: F[]): F[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export type Verdict = "approve" | "request_changes" | "inconclusive";

export function verdict(report: ReportLike, strictness: Strictness = report.request.strictness, dismissedIds: readonly string[] = []): Verdict {
  if (report.status !== "completed") return "inconclusive";
  const failedAc = report.acceptanceCriteria.some((ac) => ac.status === "failed");
  if (failedAc || blockingFindings(report, strictness, dismissedIds).length > 0) return "request_changes";
  return "approve";
}

const L = {
  de: {
    verdict: { approve: "Keine blockierenden Findings", request_changes: "Änderungen nötig", inconclusive: "Review unvollständig" },
    summary: "Zusammenfassung",
    ac: "Acceptance Criteria",
    findings: "Findings",
    blocking: "Blockierend",
    nonBlocking: "Nicht blockierend",
    affected: "Betroffene Bereiche",
    evidence: "Evidenz",
    steps: "Schritte",
    expected: "Erwartet",
    actual: "Beobachtet",
    cost: "Kosten",
    status: "Status",
    none: "keine",
    acStatus: { passed: "erfüllt", failed: "nicht erfüllt", blocked: "blockiert", not_testable: "nicht testbar" },
    severity: { blocker: "Blocker", major: "Major", minor: "Minor", suggestion: "Vorschlag" },
    fullReport: "Vollständiger Report",
    errors: "Fehler während des Runs",
    dismissed: "Von Menschen verworfene Findings (nicht aufgeführt)",
    tests: "Regressionstests",
    testsPassed: "bestanden",
    testsFailed: "Fehlgeschlagen",
    notes: "Bewertungen im Review",
    confirmedBy: "bestätigt von",
    dismissedBy: "verworfen von",
    followUp: "Nachprüfung von Review #{id}",
    followUpLine: "{fixed} behoben, {open} weiterhin offen{unchecked}.",
    followUpUnchecked: ", davon {n} nicht erneut geprüft",
    fixed: "Behoben",
    stillOpen: "Weiterhin offen",
    carried: "aus Review #{id} übernommen",
    commitStatus: {
      pending: "Claudio prüft den Pull Request …",
      testsRunning: "Review fertig, {n} Regressionstest(s) laufen noch",
      verdict: { approve: "Abnahme empfohlen", request_changes: "Änderungen nötig", inconclusive: "Review unvollständig" },
      criteria: "Kriterien",
      blocking: "blockierend",
      tests: "Tests",
    },
  },
  en: {
    verdict: { approve: "No blocking findings", request_changes: "Changes requested", inconclusive: "Review incomplete" },
    summary: "Summary",
    ac: "Acceptance criteria",
    findings: "Findings",
    blocking: "Blocking",
    nonBlocking: "Non-blocking",
    affected: "Affected areas",
    evidence: "Evidence",
    steps: "Steps",
    expected: "Expected",
    actual: "Actual",
    cost: "Cost",
    status: "Status",
    none: "none",
    acStatus: { passed: "passed", failed: "failed", blocked: "blocked", not_testable: "not testable" },
    severity: { blocker: "Blocker", major: "Major", minor: "Minor", suggestion: "Suggestion" },
    fullReport: "Full report",
    errors: "Errors during the run",
    dismissed: "Findings dismissed by a person (not listed)",
    tests: "Regression tests",
    testsPassed: "passed",
    testsFailed: "Failed",
    notes: "Review ratings",
    confirmedBy: "confirmed by",
    dismissedBy: "dismissed by",
    followUp: "Re-review of review #{id}",
    followUpLine: "{fixed} fixed, {open} still open{unchecked}.",
    followUpUnchecked: ", {n} of them not re-checked",
    fixed: "Fixed",
    stillOpen: "Still open",
    carried: "carried over from review #{id}",
    commitStatus: {
      pending: "Claudio is reviewing the pull request …",
      testsRunning: "Review done, {n} regression test(s) still running",
      verdict: { approve: "Approval recommended", request_changes: "Changes needed", inconclusive: "Review incomplete" },
      criteria: "criteria",
      blocking: "blocking",
      tests: "Tests",
    },
  },
} as const;

type Labels = (typeof L)[keyof typeof L];

const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (all, k: string) => (k in p ? String(p[k]) : all));

/** One line on a re-review: how many earlier findings are fixed and how many are still open. */
export function followUpLine(report: ReviewReport): string | null {
  const f = report.followUp;
  if (!f) return null;
  const t = labels(report);
  const fixed = f.rechecks.filter((r) => r.status === "fixed").length;
  const open = f.rechecks.length - fixed;
  const unchecked = f.rechecks.filter((r) => r.status === "not_rechecked").length;
  return `${fill(t.followUp, { id: f.reviewId })}: ${fill(t.followUpLine, { fixed, open, unchecked: unchecked ? fill(t.followUpUnchecked, { n: unchecked }) : "" })}`;
}

function labels(report: ReviewReport): Labels {
  return L[report.request.language];
}

/**
 * Description of the "Claudio" commit status, in the review's report language
 * (the language of the person it was started for). GitHub cuts it at 140 characters.
 */
export function renderCommitStatus(
  language: Language,
  state:
    | { kind: "pending" }
    | { kind: "testsRunning"; pendingTests: number }
    | { kind: "done"; verdict: Verdict; acPassed: number; acTotal: number; blocking: number; tests?: { passed: number; total: number } }
    | { kind: "failed"; verdict: Verdict; reason: string },
): string {
  const t = L[language].commitStatus;
  switch (state.kind) {
    case "pending":
      return t.pending;
    case "testsRunning":
      return t.testsRunning.replace("{n}", String(state.pendingTests));
    case "done": {
      const parts = [`${state.acPassed}/${state.acTotal} ${t.criteria}`, `${state.blocking} ${t.blocking}`];
      if (state.tests) parts.push(`${t.tests} ${state.tests.passed}/${state.tests.total}`);
      return `${t.verdict[state.verdict]}: ${parts.join(", ")}`;
    }
    case "failed":
      return `${t.verdict[state.verdict]}: ${state.reason}`;
  }
}

/** Note on Claudio's earlier change request when a newer review no longer requests changes. */
export const REVIEW_SUPERSEDED: Record<Language, string> = {
  de: "Durch ein neueres Claudio-Review ersetzt.",
  en: "Superseded by a newer Claudio review.",
};

/** Regression tests that ran with the review. */
export type ReviewTestResult = { name: string; outcome: "passed" | "failed" | "inconclusive" | null };

/** A person's rating of a finding, with the reason they gave. */
export type FindingNote = { findingId: string; status: "confirmed" | "dismissed"; comment: string | null; by: string | null };

/**
 * How a person adjusted a finished report: strictness and findings they dismissed, plus the review's regression tests.
 * `notes` adds the ratings with their reasons to the PR comment.
 */
export type RenderOptions = {
  strictness?: Strictness;
  dismissedIds?: readonly string[];
  tests?: readonly ReviewTestResult[];
  notes?: readonly FindingNote[];
};

/** A failed regression test turns an approval into "changes requested". */
export function withTests(v: Verdict, tests: readonly ReviewTestResult[] = []): Verdict {
  return v === "approve" && tests.some((t) => t.outcome === "failed") ? "request_changes" : v;
}

export function renderMarkdown(report: ReviewReport, verbosity: Verbosity = report.request.verbosity, opts: RenderOptions = {}): string {
  const t = labels(report);
  const strictness = opts.strictness ?? report.request.strictness;
  const dismissed = opts.dismissedIds ?? [];
  const v = verdict(report, strictness, dismissed);
  const blocking = blockingFindings(report, strictness, dismissed);
  const nonBlocking = sortBySeverity(report.findings.filter((f) => !dismissed.includes(f.id) && !isBlocking(f, strictness)));
  const evidenceById = new Map(report.evidence.map((e) => [e.id, e]));

  const out: string[] = [];
  out.push(`# Claudio Review: PR #${report.pr.number} ${report.pr.title}`);
  out.push("");
  out.push(`**${t.verdict[v]}** (${t.status}: ${report.status}, strictness: ${strictness})`);
  out.push("");
  out.push(`## ${t.summary}`);
  out.push("");
  out.push(report.summary.trim() || "-");
  out.push("");

  if (report.followUp) {
    out.push(`## ${fill(t.followUp, { id: report.followUp.reviewId })}`);
    out.push("");
    out.push(followUpLine(report)!.split(": ").slice(1).join(": "));
    out.push("");
    for (const r of report.followUp.rechecks) {
      const mark = r.status === "fixed" ? t.fixed : t.stillOpen;
      out.push(`- **${mark}:** [${t.severity[r.severity]}] ${r.title}${r.notes && verbosity !== "tldr" ? ` — ${r.notes.replace(/\n/g, " ")}` : ""}`);
    }
    out.push("");
  }

  if (report.acceptanceCriteria.length > 0) {
    out.push(`## ${t.ac}`);
    out.push("");
    out.push("| # | Criterion | Status | Notes |");
    out.push("|---|---|---|---|");
    report.acceptanceCriteria.forEach((ac, i) => {
      const notes = verbosity === "tldr" ? "" : ac.notes.replace(/\n/g, " ");
      out.push(`| ${i + 1} | ${ac.criterion} | ${t.acStatus[ac.status]} | ${notes} |`);
    });
    out.push("");
  }

  const renderFinding = (f: Finding) => {
    out.push(`### [${t.severity[f.severity]}] ${f.title}`);
    out.push("");
    out.push(`_${f.category}_${f.url ? ` · ${f.url}` : ""}${f.acceptanceCriterion ? ` · AC: ${f.acceptanceCriterion}` : ""}`);
    out.push("");
    out.push(f.description.trim());
    out.push("");
    if (verbosity === "detailed") {
      if (f.steps.length > 0) {
        out.push(`**${t.steps}**`);
        f.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
        out.push("");
      }
      if (f.expected) out.push(`**${t.expected}:** ${f.expected}`);
      if (f.actual) out.push(`**${t.actual}:** ${f.actual}`);
      if (f.expected || f.actual) out.push("");
      const ev = f.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
      if (ev.length > 0) {
        out.push(`**${t.evidence}:** ${ev.map((e) => (e!.path ? `[${e!.label}](${e!.path})` : e!.label)).join(", ")}`);
        out.push("");
      }
    }
  };

  out.push(`## ${t.findings}`);
  out.push("");
  out.push(`### ${t.blocking} (${blocking.length})`);
  out.push("");
  if (blocking.length === 0) out.push(`_${t.none}_`), out.push("");
  if (verbosity === "tldr") {
    blocking.forEach((f) => out.push(`- [${t.severity[f.severity]}] ${f.title}`));
    out.push("");
    out.push(`${t.nonBlocking}: ${nonBlocking.length}`);
    out.push("");
  } else {
    blocking.forEach(renderFinding);
    out.push(`### ${t.nonBlocking} (${nonBlocking.length})`);
    out.push("");
    if (nonBlocking.length === 0) out.push(`_${t.none}_`), out.push("");
    nonBlocking.forEach(renderFinding);
  }

  if (dismissed.length > 0) {
    out.push(`_${t.dismissed}: ${dismissed.length}_`);
    out.push("");
  }

  if (verbosity !== "tldr" && report.affectedAreas.length > 0) {
    out.push(`## ${t.affected}`);
    out.push("");
    report.affectedAreas.forEach((a) => out.push(`- ${a}`));
    out.push("");
  }

  if (verbosity === "detailed") {
    out.push(`## ${t.cost}`);
    out.push("");
    out.push(`| USD | Input tokens | Output tokens | Turns | Browser steps | Duration |`);
    out.push(`|---|---|---|---|---|---|`);
    out.push(
      `| ${report.cost.usd.toFixed(2)} | ${report.cost.inputTokens} | ${report.cost.outputTokens} | ${report.cost.turns} | ${report.cost.browserSteps} | ${Math.round(report.cost.durationMs / 1000)}s |`,
    );
    out.push("");
    if (report.notes.trim()) {
      out.push("## Notes");
      out.push("");
      out.push(report.notes.trim());
      out.push("");
    }
  }

  if (report.errors.length > 0) {
    out.push(`## ${t.errors}`);
    out.push("");
    report.errors.forEach((e) => out.push(`- ${e}`));
    out.push("");
  }

  return out.join("\n");
}

/** Short comment for the pull request: verdict, counts, blocking titles, link to the full report. */
export function renderPrComment(report: ReviewReport, reportUrl?: string, opts: RenderOptions = {}): string {
  const t = labels(report);
  const strictness = opts.strictness ?? report.request.strictness;
  const dismissed = opts.dismissedIds ?? [];
  const tests = opts.tests ?? [];
  const v = withTests(verdict(report, strictness, dismissed), tests);
  const blocking = blockingFindings(report, strictness, dismissed);
  const acPassed = report.acceptanceCriteria.filter((a) => a.status === "passed").length;
  const lines: string[] = [];
  lines.push(`**Claudio Review: ${t.verdict[v]}**`);
  lines.push("");
  const fu = followUpLine(report);
  if (fu) {
    lines.push(fu);
    const fixed = report.followUp!.rechecks.filter((r) => r.status === "fixed");
    fixed.slice(0, 5).forEach((r) => lines.push(`- ✅ ~~[${t.severity[r.severity]}] ${r.title}~~`));
    if (fixed.length > 5) lines.push(`- … +${fixed.length - 5}`);
    lines.push("");
  }
  lines.push(`${t.ac}: ${acPassed}/${report.acceptanceCriteria.length} ${t.acStatus.passed}. ${t.findings}: ${report.findings.length - dismissed.length} (${t.blocking.toLowerCase()}: ${blocking.length}).`);
  if (tests.length > 0) {
    const passed = tests.filter((x) => x.outcome === "passed").length;
    const failed = tests.filter((x) => x.outcome === "failed");
    lines.push(`${t.tests}: ${passed}/${tests.length} ${t.testsPassed}.${failed.length ? ` ${t.testsFailed}: ${failed.map((x) => x.name).join(", ")}.` : ""}`);
  }
  if (blocking.length > 0) {
    lines.push("");
    blocking.slice(0, 5).forEach((f) => lines.push(`- [${t.severity[f.severity]}] ${f.title}`));
    if (blocking.length > 5) lines.push(`- … +${blocking.length - 5}`);
  }
  if (report.summary.trim()) {
    lines.push("");
    lines.push(firstParagraph(report.summary));
  }
  const notes = new Map((opts.notes ?? []).map((n) => [n.findingId, n]));
  const rated = sortBySeverity(report.findings.filter((f) => notes.has(f.id)));
  if (rated.length > 0) {
    lines.push("");
    lines.push(`**${t.notes}**`);
    rated.forEach((f) => {
      const n = notes.get(f.id)!;
      const label = `[${t.severity[f.severity]}] ${f.title}`;
      const by = n.by ? ` @${n.by}` : "";
      lines.push(n.status === "confirmed" ? `- ✅ **${label}** — ${t.confirmedBy}${by}` : `- ❌ ~~${label}~~ — ${t.dismissedBy}${by}`);
      n.comment?.trim().split("\n").forEach((l) => lines.push(`  > ${l}`));
    });
  }
  if (reportUrl) {
    lines.push("");
    lines.push(`${t.fullReport}: ${reportUrl}`);
  }
  lines.push("");
  lines.push(`<sub>run ${report.runId} · ${report.cost.usd.toFixed(2)} USD · strictness ${strictness}</sub>`);
  return lines.join("\n");
}

function firstParagraph(text: string): string {
  const p = text.trim().split(/\n\s*\n/)[0] ?? "";
  return p.length > 600 ? p.slice(0, 597) + "..." : p;
}
