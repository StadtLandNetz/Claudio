import type { BudgetProfile, RepoConfig, ReviewRequest } from "@claudio/core";
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

  if (config?.notes) sections.push(`# Notes about this application\n\n${config.notes.trim()}`);
  if (request.extraInstructions) sections.push(`# Additional instructions for this run\n\n${request.extraInstructions.trim()}`);

  sections.push(`# Procedure

1. Extract the acceptance criteria from the issue(s) and PR description. If they are implicit, formulate them explicitly. Add them to the todo list with todo_add, one item per criterion.
2. Impact analysis: from the diff (and the checkout, if available) determine which screens, routes, flows and shared components are affected. Add regression checks for those to the todo list. Keep this proportional to the size of the change.
3. Log in with login_as and build a mental map of the app around the affected areas (snapshot, navigate, read). Do not click through unrelated areas.
4. Work the todo list with todo_next / todo_done. For each criterion: perform the flow, capture_evidence, check get_console and get_network for errors, then record_ac_result. For each regression item: verify the existing behaviour still works and record findings when it does not.
5. Judge UX and UI of the changed screens: consistency with the rest of the app, feedback on actions, error states, wording, layout. You may delegate screenshot review to the ux-reviewer subagent. Record findings with report_finding.
6. Finish with a summary in ${lang} as your final message. Structure it as:
   - A verdict sentence.
   - Summary (per the verbosity setting).
   - A section titled "Affected areas:" with one bullet per affected screen or flow (one line each, keep this heading in English).
   - Anything you could not test and why.
Do not repeat every finding in the summary; they are rendered from the records.`);

  return sections.join("\n\n");
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
