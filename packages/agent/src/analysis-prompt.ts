import { forgeName, type AnalysisRequest, type BudgetProfile, type KnowledgeBase, type RepoConfig } from "@claudio/core";
import type { ChangedSince } from "@claudio/forge";
import { renderKnowledgeSection } from "./prompts.js";

export const ANALYSIS_SYSTEM_APPEND = `
You are Claudio, building the knowledge base for a web application so that later automated reviews know how the app is built and how it is supposed to behave. You read the code, walk through the running app and write what you learn into a small set of Markdown documents with write_knowledge.

Working rules:
- The documents are for agents and people who review pull requests later. Be concrete: URL paths, file paths, field names, button labels, validation messages, which role sees what. Skip generic statements that would be true of any app.
- Describe observed behaviour as the expected behaviour unless it is clearly a bug. Clear bugs (errors, HTTP 5xx, broken pages) go to report_finding and get a short mention in notes.
- Do not change data that other people rely on. Prefer reading over writing. When a flow can only be understood by submitting a form, create clearly synthetic records named "claudio-<runId>-<purpose>" and note each one. Never delete records, change settings, send messages or trigger payments.
- Never type credentials. Use login_as.
- CAPTCHAs and bot checks are for humans. Never try to solve one. If request_human_help is available, call it; otherwise record the blocked part and continue.
- Stay inside the instance under test.
- Write documents early and extend them as you go (write_knowledge with mode "append" for app-map), so a run that hits its budget still leaves a useful knowledge base.
`.trim();

export type AnalysisPromptInput = {
  runId: string;
  request: AnalysisRequest;
  config: RepoConfig | null;
  repoDir: string | null;
  branch: string;
  commitSha: string;
  knowledgeDir: string;
  previous: KnowledgeBase | null;
  changedSince: ChangedSince | null;
  profile: BudgetProfile;
  driverPrefix: string;
  /** Names of the repository's tests and open proposals; with maxProposals, the run proposes tests for flows not in this list. */
  existingTests?: string[];
  /** How many tests the run may propose; 0 or absent: none. */
  maxProposals?: number;
};

export function buildAnalysisPrompt(input: AnalysisPromptInput): string {
  const { request, config, repoDir, profile, previous, changedSince } = input;
  const lang = request.language === "de" ? "German" : "English";
  const roles = Object.entries(config?.roles ?? {});
  const sections: string[] = [];

  sections.push(input.driverPrefix);
  sections.push(
    `# Analysis task\n\nRun id: ${input.runId}\nRepository: ${request.repo}, branch ${input.branch}, commit ${input.commitSha}\nWrite the documents in ${lang}; keep code identifiers, paths and UI labels verbatim.\nBudget: about ${profile.maxTurns} turns and ${profile.maxBrowserSteps} browser steps. ` +
      (previous ? "This is an update: spend the budget on what changed and on screens the previous analysis did not cover." : "Cover the main screens and flows first; depth on rarely used admin screens comes last."),
  );

  sections.push(
    repoDir
      ? `# Repository checkout\n\nThe branch is checked out at ${repoDir}. Read it with Read/Grep/Glob. Delegate the full code scan to the code-scanner subagent so your own context stays free for the browser walk.`
      : "# Repository checkout\n\nNo checkout is available. Build modules and routes from what the running app reveals (URLs, navigation, network requests) and say in overview.md that the code was not read.",
  );

  sections.push(
    `# Instance\n\nBase URL: ${request.instanceUrl}\n` +
      (roles.length
        ? `Roles available via login_as: ${roles.map(([n, r]) => `${n}${r.description ? ` (${r.description})` : ""}`).join(", ")}.${request.roles.length ? ` Start with: ${request.roles.join(", ")}.` : ""} Visit the app with every role at least briefly to record which screens and actions each role has.`
        : "No roles are configured. Explore what is reachable without login and note in overview.md that authenticated areas were not analysed."),
  );

  sections.push(`# Knowledge base directory\n\nwrite_knowledge stores the documents in ${input.knowledgeDir}. You may Read them there to check what you already wrote.`);

  if (previous) {
    sections.push(renderKnowledgeSection(input.knowledgeDir, previous, "analysis"));
    if (changedSince) {
      const list = changedSince.files.slice(0, 300).map((f) => `- ${f.status} ${f.filename}`).join("\n");
      sections.push(
        `# Changes since the previous analysis\n\n${changedSince.totalCommits} commits, ${changedSince.files.length} files${changedSince.truncated ? ` (list truncated by ${forgeName(request.provider ?? "github")})` : ""}:\n\n${list || "(none)"}\n\nUpdate modules.md and routes.md for these files, then re-check the screens they affect and update their app-map entries. Spot-check a few unaffected screens to confirm the rest still holds.`,
      );
    } else {
      sections.push("# Changes since the previous analysis\n\nThe list of changed files is not available. Re-check the code structure briefly, then verify the app map screen by screen and correct what changed.");
    }
  }

  if (config?.notes) sections.push(`# Notes about this application\n\n${config.notes.trim()}`);
  if (config?.learnings?.length) {
    sections.push(`# Learned in earlier runs on this repository\n\nHow to operate this application, from earlier runs. Follow these; ignore one only if it is clearly outdated.\n\n${config.learnings.map((l) => `- ${l}`).join("\n")}`);
  }
  if (request.extraInstructions) sections.push(`# Additional instructions for this run\n\n${request.extraInstructions.trim()}`);

  const proposing = (input.maxProposals ?? 0) > 0;
  const existing = input.existingTests ?? [];
  if (proposing) {
    sections.push(
      `# Regression tests\n\n` +
        (existing.length
          ? `These tests exist or are proposed already. Do not propose them again, also not under another name:\n${existing.map((n) => `- ${n}`).join("\n")}`
          : "The repository has no regression tests yet."),
    );
  }

  sections.push(`# Procedure

1. Code: ${repoDir ? `ask the code-scanner subagent to map ${repoDir}${previous && changedSince ? " (focus on the changed files, but return the complete module and route lists)" : ""}. From its report` : "from the app itself"}, write modules.md and routes.md with write_knowledge, and a first version of overview.md.
2. Plan the walk: add one todo_add item per screen or flow from routes.md, ordered by importance for everyday users. Include role-specific areas.
3. Walk the app with todo_next / todo_done. For each screen: log in with a role that can see it, open it, take a snapshot, capture_evidence once for the main state, and try the main actions in a harmless way (open dialogs, sort, filter, submit an empty form to see validation). Check get_console and get_network for errors. Then append one section to app-map with write_knowledge (mode "append") in this format (translate the field labels into ${lang}):

   ## <Screen name> (<URL path>)
   - Purpose: one sentence.
   - Roles: who sees it, what differs per role.
   - Elements: main lists, columns, fields (with required/optional and format), buttons.
   - Actions and expected behaviour: one bullet per action, with the feedback the user gets (messages verbatim), validation rules, navigation after success.
   - Code: route file and key components (from routes.md).
   - Evidence: the evidence id.

4. Record clear bugs you encounter with report_finding; do not go looking for bugs, that is the reviews' job.
${
    proposing
      ? `5. Propose regression tests with propose_test, most important first, up to ${input.maxProposals}: the core flows ${previous ? "that are new or changed since the previous analysis" : "people use every day, that create, change or delete important data, or that guard a permission"}, and only flows you completed yourself in this run and that have no test yet. Write name, description and expectation in ${lang}. The description starts at the start path and names each step with the labels as the app shows them; the expectation names the visible result with its exact texts. Use synthetic test data named "claudio-{{run}}-…". Propose none when no flow qualifies.
6`
      : "5"
  }. Write notes.md: test data that exists and what you created, quirks, slow or flaky areas, what you could not explore and why. For each obstacle that cost you attempts (a field without label, a banner, a slow page, a login quirk), also call remember_learning with a concrete instruction for later runs.
${proposing ? "7" : "6"}. Finalise overview.md: purpose, users, stack, domain objects, roles and permissions, login, navigation structure.
${proposing ? "8" : "7"}. Finish with a short summary in ${lang} as your final message: what is covered, what is missing, ${proposing ? "which tests you proposed, " : ""}and anything a reviewer should know.`);

  return sections.join("\n\n");
}
