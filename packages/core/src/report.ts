import type { Finding, ReviewReport, Severity, Strictness, Verbosity } from "./schemas.js";

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

export function isBlocking(finding: Finding, strictness: Strictness): boolean {
  return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[STRICTNESS_THRESHOLD[strictness]];
}

export function blockingFindings(report: ReviewReport, strictness: Strictness = report.request.strictness): Finding[] {
  return sortBySeverity(report.findings.filter((f) => isBlocking(f, strictness)));
}

export function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function verdict(report: ReviewReport, strictness: Strictness = report.request.strictness): "approve" | "request_changes" | "inconclusive" {
  if (report.status !== "completed") return "inconclusive";
  const failedAc = report.acceptanceCriteria.some((ac) => ac.status === "failed");
  if (failedAc || blockingFindings(report, strictness).length > 0) return "request_changes";
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
  },
} as const;

type Labels = (typeof L)[keyof typeof L];

function labels(report: ReviewReport): Labels {
  return L[report.request.language];
}

export function renderMarkdown(report: ReviewReport, verbosity: Verbosity = report.request.verbosity): string {
  const t = labels(report);
  const strictness = report.request.strictness;
  const v = verdict(report, strictness);
  const blocking = blockingFindings(report, strictness);
  const nonBlocking = sortBySeverity(report.findings.filter((f) => !isBlocking(f, strictness)));
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
export function renderPrComment(report: ReviewReport, reportUrl?: string): string {
  const t = labels(report);
  const strictness = report.request.strictness;
  const v = verdict(report, strictness);
  const blocking = blockingFindings(report, strictness);
  const acPassed = report.acceptanceCriteria.filter((a) => a.status === "passed").length;
  const lines: string[] = [];
  lines.push(`**Claudio Review: ${t.verdict[v]}**`);
  lines.push("");
  lines.push(`${t.ac}: ${acPassed}/${report.acceptanceCriteria.length} ${t.acStatus.passed}. ${t.findings}: ${report.findings.length} (${t.blocking.toLowerCase()}: ${blocking.length}).`);
  if (blocking.length > 0) {
    lines.push("");
    blocking.slice(0, 5).forEach((f) => lines.push(`- [${t.severity[f.severity]}] ${f.title}`));
    if (blocking.length > 5) lines.push(`- … +${blocking.length - 5}`);
  }
  if (report.summary.trim()) {
    lines.push("");
    lines.push(firstParagraph(report.summary));
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
