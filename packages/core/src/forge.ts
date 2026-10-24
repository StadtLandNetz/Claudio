import { z } from "zod";

/** Where a repository lives. GitHub and GitLab can be connected at the same time. */
export const PROVIDERS = ["github", "gitlab"] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

/** The provider of a stored row or request; rows from before GitLab support carry none and are GitHub. */
export const providerOf = (x: { provider?: Provider | null } | null | undefined): Provider => x?.provider ?? "github";

export const forgeName = (provider: Provider): string => (provider === "gitlab" ? "GitLab" : "GitHub");

/** owner/name on GitHub, group/…/project on GitLab (groups can be nested). */
export const RepoFullNameSchema = z.string().regex(/^[\w.-]+(\/[\w.-]+)+$/, "repo must be owner/name or group/…/project");

export { isValidFullName, parseRepoInput, parseRepoPath, repoHref, repoPath, splitRepo } from "./repo-path.js";

/** How a provider calls its change requests. */
export type ChangeTerms = {
  forge: string;
  /** Mid-sentence English: "pull request" / "merge request". */
  change: string;
  /** Sentence start English: "Pull request" / "Merge request". */
  Change: string;
  /** Title case, also the German noun: "Pull Request" / "Merge Request". */
  Title: string;
  short: "PR" | "MR";
  /** Reference prefix: #12 on GitHub, !12 on GitLab. */
  prefix: "#" | "!";
};

const TERMS: Record<Provider, ChangeTerms> = {
  github: { forge: "GitHub", change: "pull request", Change: "Pull request", Title: "Pull Request", short: "PR", prefix: "#" },
  gitlab: { forge: "GitLab", change: "merge request", Change: "Merge request", Title: "Merge Request", short: "MR", prefix: "!" },
};

export const changeTerms = (provider: Provider | null | undefined): ChangeTerms => TERMS[provider ?? "github"];

/** "#12" on GitHub, "!12" on GitLab. */
export const changeRef = (provider: Provider | null | undefined, n: number): string => `${changeTerms(provider).prefix}${n}`;

/**
 * Whether a deployment environment belongs to the configured one: the same name
 * (case-insensitive) or an environment in its folder, as GitLab names review apps
 * ("review" covers "review/16-neue-fahrt").
 */
export function envMatches(configured: string, actual: string): boolean {
  const c = configured.trim().toLowerCase();
  const a = actual.trim().toLowerCase();
  return !!c && (a === c || a.startsWith(`${c}/`));
}

/** Links into GitHub or GitLab, from the repository's web address (which the server knows). */
export function forgeLinks(provider: Provider | null | undefined, webUrl: string) {
  const gitlab = provider === "gitlab";
  return {
    repo: webUrl,
    branch: (branch: string) => (gitlab ? `${webUrl}/-/tree/${branch}` : `${webUrl}/tree/${branch}`),
    /** Starts a new pull or merge request from the branch. */
    newChange: (branch: string) =>
      gitlab ? `${webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}` : `${webUrl}/compare/${branch}?expand=1`,
  };
}

/** Per-repository automation settings. */
export type AutomationSettings = {
  /** Instance URL of a PR, e.g. https://pr-{pr}.preview.example.de. Placeholders: {pr}, {branch}, {branch_slug}, {sha}. */
  instanceUrlTemplate: string;
  onComment: boolean;
  onLabel: boolean;
  /** Review every opened, reopened or updated (pushed) PR. */
  onPush: boolean;
  /** Update the knowledge base when the default branch receives a push. */
  analyzeOnMerge: boolean;
  /** Report the result as a commit status on the PR head. */
  commitStatus: boolean;
  /**
   * Environment of the PR review instances (e.g. "Preview" on GitHub, "review" on
   * GitLab, which also covers review/<branch>). When set, the instance URL comes
   * from the PR's deployment in that environment, and automatic reviews start once
   * that deployment succeeds instead of on the push.
   */
  deploymentEnvironment?: string;
};

/** Builds a PR's instance URL from the repo's template. */
export function renderInstanceUrl(template: string, pr: { number: number; branch: string; sha: string }): string {
  const slug = pr.branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return template
    .replace(/\{pr\}/g, String(pr.number))
    .replace(/\{branch_slug\}/g, slug)
    .replace(/\{branch\}/g, encodeURIComponent(pr.branch))
    .replace(/\{sha\}/g, pr.sha);
}
