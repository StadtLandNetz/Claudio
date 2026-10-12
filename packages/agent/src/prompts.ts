import { KNOWLEDGE_DOCS, type BudgetProfile, type KnowledgeBase, type RepoConfig, type ReviewRequest } from "@claudio/core";
import type { PullRequestContext } from "@claudio/github";

export const SYSTEM_APPEND = `
You are Claudio, an automated user-acceptance reviewer for web applications. You replace the manual review a QA engineer performs before a feature branch is merged: verify the ticket's acceptance criteria in the running app, check that existing behaviour did not regress, judge UX and UI consistency, and document everything with evidence.

Working rules:
- Work adaptively. Do not assume specific test data exists. Discover the app's state from the UI, create what you need, and prefix names of records you create with "claudio-<runId>" so people can find and clean them up. Note every record you create with the note tool.
- Evidence first. Every finding and every acceptance-criterion result must reference evidence captured with capture_evidence. A claim without evidence is worth little to the humans reading the report.
- Record results through the Claudio tools (report_finding, record_ac_result), not only in prose. The report is generated from those records; the prose is the summary.
- Severity: blocker = feature unusable or data loss; major = acceptance criterion not met or a clear functional bug; minor = wrong but workable; suggestion = improvement idea. Do not inflate.
- Be precise about what you observed versus what you infer. If something could not be tested (missing data, missing permission, broken login), record it as blocked or not_testable rather than guessing.
- Never type credentials into the browser. Use login_as.
- Stay inside the instance under test. Do not interact with production systems or external services.
- Read the repository with Read/Grep/Glob to understand what the diff touches; you cannot run commands.
`.trim();

export type PromptInput = {
  runId: string;
  request: ReviewRequest;
  pr: PullRequestContext;
  config: RepoConfig | null;
  repoDir: string | null;
  profile: BudgetProfile;
  driverPrefix: string;
  maxDiffChars?: number;
  /** Knowledge base files written for this run. */
  knowledge?: { dir: string; base: KnowledgeBase } | null;
};

export function buildReviewPrompt(input: PromptInput): string {
  const { request, pr, config, repoDir, profile, driverPrefix } = input;
  const roles = Object.entries(config?.roles ?? {});
  const lang = request.language === "de" ? "German" : "English";

  const verbosityGuide = {
    tldr: "Keep the final summary to a few sentences: verdict, what works, what blocks.",
    normal: "Write a concise summary (one or two paragraphs) plus a short list of the most important observations.",
    detailed: "Write a thorough summary: what you tested in which order, what you could not test and why, observations beyond the findings, and concrete improvement ideas.",
  }[request.verbosity];

  const strictnessGuide = {
    lenient: "Report only real functional problems as blocker/major; treat polish and consistency issues as suggestions.",
    normal: "Report functional problems and clear UX/UI inconsistencies; use minor for cosmetic issues and suggestion for ideas.",
    strict: "Be thorough and exacting: inconsistent wording, spacing, missing feedback, missing loading or error states and accessibility problems are findings (minor), not suggestions.",
  }[request.strictness];

  const sections: string[] = [];
  sections.push(driverPrefix);
  sections.push(`# Review task\n\nRun id: ${input.runId}\nReport language: ${lang}\nVerbosity: ${request.verbosity}. ${verbosityGuide}\nStrictness: ${request.strictness}. ${strictnessGuide}\nBudget: about ${profile.maxTurns} turns and ${profile.maxBrowserSteps} browser steps. Plan accordingly: cover acceptance criteria first, then regressions on the affected areas, then UX/UI.`);

  sections.push(`# Pull request #${pr.number}: ${pr.title}\n\nURL: ${pr.url}\nBranch: ${pr.headRef} → ${pr.baseRef}${pr.author ? `\nAuthor: ${pr.author}` : ""}${pr.draft ? "\nDraft PR" : ""}\n\n## Description\n\n${pr.body.trim() || "(empty)"}`);

  if (pr.issues.length > 0) {
    sections.push(
      `# Linked issues\n\n` +
        pr.issues
          .map((i) => `## #${i.number}: ${i.title}${i.labels.length ? ` [${i.labels.join(", ")}]` : ""}\n${i.url}\n\n${i.body.trim() || "(empty)"}`)
          .join("\n\n"),
    );
  } else {
    sections.push("# Linked issues\n\nNone found. Derive the acceptance criteria from the PR description and the diff, and say in the summary that no ticket was linked.");
  }

  sections.push(renderDiff(pr, input.maxDiffChars ?? 60_000));

  sections.push(
    `# Instance under test\n\nBase URL: ${request.instanceUrl}\n` +
      (roles.length > 0
        ? `Roles available via login_as: ${roles.map(([n, r]) => `${n}${r.description ? ` (${r.description})` : ""}`).join(", ")}.` +
          (request.roles.length > 0 ? ` Start with: ${request.roles.join(", ")}.` : "")
        : "No roles are configured. If the app needs a login, record the affected criteria as blocked."),
  );

  if (repoDir) {
    sections.push(`# Repository checkout\n\nThe PR branch is checked out at ${repoDir}. Use Read/Grep/Glob there for impact analysis (routes, components, shared modules the diff touches). You may delegate the code reading to the impact-analyst subagent.`);
  }

  if (input.knowledge) sections.push(renderKnowledgeSection(input.knowledge.dir, input.knowledge.base, "review"));

  if (config?.notes) sections.push(`# Notes about this application\n\n${config.notes.trim()}`);
  if (request.extraInstructions) sections.push(`# Additional instructions for this run\n\n${request.extraInstructions.trim()}`);

  sections.push(profile.delegateChecks ? delegatedProcedure(lang) : singleAgentProcedure(lang));

  return sections.join("\n\n");
}

/** Routes and app map are inlined for reviews up to this size; larger knowledge bases stay files. */
export const KNOWLEDGE_INLINE_LIMIT = 24_000;

/**
 * Knowledge base section. For reviews, routes.md and app-map.md are inlined when
 * they are small, so the impact analysis does not depend on the agent choosing to
 * read them; everything else is referenced by path.
 */
export function renderKnowledgeSection(dir: string, base: KnowledgeBase, purpose: "review" | "analysis"): string {
  const header = `# Knowledge base (commit ${base.commitSha.slice(0, 7)} on ${base.branch}, analysed ${base.analyzedAt.slice(0, 10)})`;
  const files = base.docs.map((d) => `- ${dir}/${KNOWLEDGE_DOCS[d.name].file}: ${KNOWLEDGE_DOCS[d.name].purpose}`).join("\n");
  if (purpose === "analysis") {
    return `${header}\n\n${files}\n\nThis is the knowledge base from the previous analysis. Update it rather than starting over: keep what is still true, correct what changed, add what is new.`;
  }

  const core = base.docs.filter((d) => d.name === "routes" || d.name === "app-map");
  const inline = core.length > 0 && core.reduce((n, d) => n + d.content.length, 0) <= KNOWLEDGE_INLINE_LIMIT;
  const caveat =
    "The code may have changed since this analysis; trust the running app and the diff over the knowledge base when they disagree, and note outdated entries with the note tool.";
  if (inline) {
    const body = core.map((d) => `## ${KNOWLEDGE_DOCS[d.name].file}\n\n${d.content.trim()}`).join("\n\n");
    return `${header}\n\nUse the route index below to map the changed files to screens, and the app map as the expected behaviour of those screens: a deviation from it is a regression candidate. ${caveat}\n\nFurther documents (read when useful):\n${files}\n\n${body}`;
  }
  return `${header}\n\n${files}\n\nBefore the impact analysis, Read routes.md to map the changed files to screens. Before testing a screen, Read its app-map.md section: it is the expected behaviour, so a deviation is a regression candidate. Read notes.md for test data and quirks. ${caveat}`;
}

const SUMMARY_STEP = (lang: string) => `Finish with a summary in ${lang} as your final message. Structure it as:
   - A verdict sentence.
   - Summary (per the verbosity setting).
   - A section titled "Affected areas:" with one bullet per affected screen or flow (one line each, keep this heading in English).
   - Anything you could not test and why.
Do not repeat every finding in the summary; they are rendered from the records.`;

/** Quick budget: one agent does everything. */
function singleAgentProcedure(lang: string): string {
  return `# Procedure

1. Extract the acceptance criteria from the issue(s) and PR description. If they are implicit, formulate them explicitly. Add them to the todo list with todo_add, one item per criterion.
2. Impact analysis: from the diff (and the checkout, if available) determine which screens, routes, flows and shared components are affected. Add regression checks for those to the todo list. Keep this proportional to the size of the change.
3. Log in with login_as and build a mental map of the app around the affected areas (snapshot, navigate, read). Do not click through unrelated areas.
4. Work the todo list with todo_next / todo_done. For each criterion: perform the flow, capture_evidence, check get_console and get_network for errors, then record_ac_result. For each regression item: verify the existing behaviour still works and record findings when it does not.
5. Judge UX and UI of the changed screens: consistency with the rest of the app, feedback on actions, error states, wording, layout. You may delegate screenshot review to the ux-reviewer subagent. Record findings with report_finding.
6. ${SUMMARY_STEP(lang)}`;
}

/**
 * Standard and thorough budgets: separate subagents verify the criteria, check
 * regressions and judge the UI, each with a fresh context. They share one
 * browser, so they run one after the other.
 */
function delegatedProcedure(lang: string): string {
  return `# Procedure

You coordinate specialised subagents. The browser subagents (ac-verifier, regression-tester) share one browser: run them one after the other, never in parallel. They record their results with the Claudio tools themselves; do not record the same results again.

1. Extract the acceptance criteria from the issue(s) and PR description. If they are implicit, formulate them explicitly as testable statements, numbered.
2. Impact analysis: map the changed files to screens and flows (route index from the knowledge base, if available). For diffs larger than a handful of files or touching shared modules, delegate this to the impact-analyst subagent. Result: affected areas, each with direct/indirect and one concrete regression check, ordered by risk.
3. Delegate to ac-verifier. Give it: run id, instance URL, roles, the numbered criteria, the app-map entries of the screens involved, and notes on test data.
4. Delegate to regression-tester. Give it: run id, instance URL, roles, the affected areas with their checks, and the app-map entries of those screens. Skip this step when the change is isolated and no area beyond the new feature is affected; say so in the summary.
5. Delegate to ux-reviewer: the evidence file paths of the changed screens (from the evidence directory of this run) with one line on each screen's purpose. Record the observations you agree with via report_finding (category ux or ui), with the evidence ids.
6. Check the records: every criterion has a result (record_ac_result for any the ac-verifier missed, as blocked with the reason). Do not re-test what the subagents covered.
7. ${SUMMARY_STEP(lang)}`;
}

function renderDiff(pr: PullRequestContext, maxChars: number): string {
  const lines: string[] = [`# Changed files (${pr.files.length})`, ""];
  for (const f of pr.files) lines.push(`- ${f.status} ${f.filename}${f.previousFilename ? ` (was ${f.previousFilename})` : ""} (+${f.additions} -${f.deletions})`);
  lines.push("", "## Patches", "");
  let used = 0;
  let omitted = 0;
  for (const f of pr.files) {
    if (!f.patch) continue;
    const block = `### ${f.filename}\n\`\`\`diff\n${f.patch}\n\`\`\`\n`;
    if (used + block.length > maxChars) {
      omitted++;
      continue;
    }
    used += block.length;
    lines.push(block);
  }
  if (omitted > 0) lines.push(`(${omitted} patches omitted for size; read those files in the checkout if relevant.)`);
  return lines.join("\n");
}

export function extractAffectedAreas(summary: string): string[] {
  const m = summary.match(/affected areas:?\s*\n([\s\S]*?)(?:\n\s*\n|$)/i);
  if (!m) return [];
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0 && !/^#/.test(l));
}
