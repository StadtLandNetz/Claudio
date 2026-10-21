import { KNOWLEDGE_DOCS, type BudgetProfile, type FollowUpContext, type KnowledgeBase, type RepoConfig, type ReviewRequest } from "@claudio/core";
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
- CAPTCHAs and bot checks are for humans. Never try to solve one. If request_human_help is available, call it; otherwise record the blocked part and continue.
- When something open in the ticket decides a result (what a criterion means, which data or role to use, whether a behaviour is intended) and ask_human is available, ask instead of guessing or recording not_testable. Ask only what you cannot find out yourself.
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
  /** Re-review: the earlier review of this pull request it builds on. */
  followUp?: FollowUpContext | null;
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
  if (config?.lessons?.length) {
    sections.push(
      `# Decisions from earlier reviews\n\nPeople dismissed these findings in earlier reviews of this repository. Treat the described behaviour as intended: do not report it again unless this pull request changes it.\n\n${config.lessons.map((l) => `- ${l}`).join("\n")}`,
    );
  }
  if (config?.learnings?.length) {
    sections.push(
      `# Learned in earlier runs on this repository\n\nHow to operate this application, from earlier runs that had to find out the hard way. Follow these; ignore one only if it is clearly outdated. When you overcome a new obstacle that cost you attempts (a field without label, a banner, a slow page, a login quirk), call remember_learning.\n\n${config.learnings.map((l) => `- ${l}`).join("\n")}`,
    );
  }
  if (request.viewports.includes("mobile")) sections.push(renderViewports(request.viewports));
  if (request.criteria?.length) sections.push(renderConfirmedCriteria(request.criteria));
  if (input.followUp) sections.push(renderFollowUp(input.followUp));
  if (request.extraInstructions) sections.push(`# Additional instructions for this run\n\n${request.extraInstructions.trim()}`);

  const confirmed = Boolean(request.criteria?.length);
  sections.push(
    input.followUp ? followUpProcedure(lang, input.followUp, confirmed) : profile.delegateChecks ? delegatedProcedure(lang, confirmed) : singleAgentProcedure(lang, confirmed),
  );

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

/** Phone checks: the whole review on a phone, or desktop first and the changed screens on the phone afterwards. */
export function renderViewports(viewports: ReviewRequest["viewports"]): string {
  if (!viewports.includes("desktop")) {
    return `# Viewport: phone

The browser emulates a phone (390×844, touch, mobile user agent) for the whole review. Judge every screen as a phone user sees it: navigation behind a menu button, readable text without zooming, tap targets large enough, no horizontal scrolling, forms usable with the on-screen keyboard. Say in findings that they concern the phone.`;
  }
  return `# Viewports: desktop and phone

Do the review in the desktop viewport first. Then call set_viewport with "mobile", reload, and check the screens this pull request changes again on the phone: layout and navigation (menu button), readable text, tap targets, no horizontal scrolling, forms and dialogs usable. Re-run the main flow of each acceptance criterion on the phone once; record a criterion as failed only if it fails on either viewport, and say which one in the notes. Start the title of a phone-only finding with "Mobil:" (German) or "Mobile:" (English).`;
}

/** A person confirmed the criteria before the run: they replace the agent's own reading of the ticket. */
export function renderConfirmedCriteria(criteria: string[]): string {
  return `# Acceptance criteria (confirmed by a person)

A person reviewed and edited these criteria before the run. Test exactly these: do not drop, merge or reword them, and use the text below verbatim as the criterion in record_ac_result. You may still add regression checks for affected areas, but not further criteria.

${criteria.map((c, k) => `${k + 1}. ${c.trim()}`).join("\n")}`;
}

const STEP_CRITERIA = (confirmed: boolean) =>
  confirmed
    ? "Take the confirmed acceptance criteria above as they are. Add them to the todo list with todo_add, one item per criterion."
    : "Extract the acceptance criteria from the issue(s) and PR description. If they are implicit, formulate them explicitly. Add them to the todo list with todo_add, one item per criterion.";

/** Re-review: what the earlier review found, so this one can check the fixes and what changed since. */
export function renderFollowUp(f: FollowUpContext): string {
  const changed =
    f.changedFiles === null
      ? "GitHub could not tell which files changed since then: treat every affected area as changed."
      : f.changedFiles.length === 0
        ? "No files changed since then (the instance may have been redeployed or its data changed)."
        : `${f.changedFiles.length} file(s) changed since then:\n${f.changedFiles.slice(0, 80).map((x) => `- ${x}`).join("\n")}${f.changedFiles.length > 80 ? `\n- … +${f.changedFiles.length - 80}` : ""}`;
  const criteria = f.criteria.length ? f.criteria.map((c, k) => `${k + 1}. [${c.status}] ${c.criterion}${c.notes ? `\n   Notes then: ${c.notes.replace(/\s+/g, " ").slice(0, 300)}` : ""}`).join("\n") : "(none recorded)";
  const findings = f.findings.length
    ? f.findings
        .map(
          (x) =>
            `## ${x.id} [${x.severity}] ${x.title}${x.rating === "confirmed" ? " (confirmed by a person)" : ""}\n${x.description}${x.steps.length ? `\nSteps: ${x.steps.join(" → ")}` : ""}${x.expected ? `\nExpected: ${x.expected}` : ""}${x.actual ? `\nActual then: ${x.actual}` : ""}${x.url ? `\nURL: ${x.url}` : ""}${x.comment ? `\nReviewer comment: ${x.comment}` : ""}`,
        )
        .join("\n\n")
    : "(no open findings)";
  return `# Re-review of review #${f.reviewId}

This pull request was reviewed before${f.headSha ? ` at commit ${f.headSha.slice(0, 7)}` : ""}. This run is a re-review: confirm what was fixed, re-check what is still open, and test only what changed since. Do not repeat the whole review.

## What changed since review #${f.reviewId}

${changed}

## Its acceptance criteria and their results

${criteria}

## Its open findings (to re-check)

${findings}
${f.dismissed.length ? `\n## Dismissed by people (intended behaviour, never report again)\n\n${f.dismissed.map((t) => `- ${t}`).join("\n")}\n` : ""}
## Its summary

${f.summary.trim().slice(0, 2000) || "(none)"}`;
}

/** Re-review: one agent re-checks the earlier findings, re-tests what changed, and leaves the rest as it was. */
function followUpProcedure(lang: string, f: FollowUpContext, confirmed: boolean): string {
  return `# Procedure (re-review)

1. ${
    confirmed
      ? "The confirmed acceptance criteria above are the criteria of this run."
      : `The criteria of review #${f.reviewId} are the criteria of this run; add criteria only if the PR or the ticket changed in a way that requires them.`
  } Use each criterion's text verbatim in record_ac_result.
2. Map the changed files to screens and flows (route index from the knowledge base, if available). These and the screens of the open findings are what you test.
3. Log in with login_as. For every open finding of review #${f.reviewId}: follow its steps, capture_evidence of the current state, then call recheck_finding with "fixed" or "still_open". Do not report it again with report_finding.
4. Re-test every criterion that failed, was blocked or not testable, and every criterion whose screens are touched by the changes; record_ac_result for each. Criteria you do not re-test keep their earlier result automatically: say in the notes of the summary which ones you left as they were.
5. Look for regressions only around the changed files, and report new problems with report_finding as usual.
6. ${SUMMARY_STEP(lang)} Begin the summary with what was fixed and what is still open.`;
}

/** Quick budget: one agent does everything. */
function singleAgentProcedure(lang: string, confirmed = false): string {
  return `# Procedure

1. ${STEP_CRITERIA(confirmed)}
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
function delegatedProcedure(lang: string, confirmed = false): string {
  return `# Procedure

You coordinate specialised subagents. The browser subagents (ac-verifier, regression-tester) share one browser: run them one after the other, never in parallel. They record their results with the Claudio tools themselves; do not record the same results again.

1. ${confirmed ? "Take the confirmed acceptance criteria above as they are, numbered." : "Extract the acceptance criteria from the issue(s) and PR description. If they are implicit, formulate them explicitly as testable statements, numbered."}
2. Impact analysis: map the changed files to screens and flows (route index from the knowledge base, if available). For diffs larger than a handful of files or touching shared modules, delegate this to the impact-analyst subagent. Result: affected areas, each with direct/indirect and one concrete regression check, ordered by risk.
3. Delegate to ac-verifier. Give it: run id, instance URL, roles, the numbered criteria${confirmed ? " (verbatim, with the instruction to use that text in record_ac_result)" : ""}, the app-map entries of the screens involved, and notes on test data.
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
