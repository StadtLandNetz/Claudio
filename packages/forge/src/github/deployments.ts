import type { Octokit } from "octokit";
import type { PreviewDeployment } from "../types.js";
import { parseRepo } from "./links.js";

export type { PreviewDeployment } from "../types.js";

/** How many of a PR's newest commits are searched when the head commit has no deployment. */
const FALLBACK_COMMITS = 10;

/**
 * The live instance of a commit: the newest deployment whose latest status is
 * "success" with an environment URL. Deployments whose latest status is
 * inactive, failed or still running are skipped (the instance is gone or not ready).
 * Without an environment name, production deployments are ignored.
 */
async function deploymentForSha(octokit: Octokit, owner: string, repo: string, sha: string, environment?: string): Promise<Omit<PreviewDeployment, "exact"> | null> {
  const { data: deployments } = await octokit.rest.repos.listDeployments({ owner, repo, sha, environment: environment || undefined, per_page: 10 });
  for (const d of deployments) {
    if (!environment && d.production_environment) continue;
    const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: d.id, per_page: 1 });
    const latest = statuses[0];
    if (latest?.state === "success" && latest.environment_url) {
      return { url: latest.environment_url, environment: d.environment, sha, deployedAt: latest.created_at };
    }
  }
  return null;
}

/**
 * Finds the review instance of a pull request: first for the given commit,
 * then (with a PR number) for the PR's most recent earlier commits.
 */
export async function findPreviewDeployment(
  octokit: Octokit,
  repoFullName: string,
  opts: { sha: string; prNumber?: number; environment?: string },
): Promise<PreviewDeployment | null> {
  const { owner, repo } = parseRepo(repoFullName);
  const exact = await deploymentForSha(octokit, owner, repo, opts.sha, opts.environment);
  if (exact) return { ...exact, exact: true };
  if (!opts.prNumber) return null;

  const commits = await octokit.paginate(octokit.rest.pulls.listCommits, { owner, repo, pull_number: opts.prNumber, per_page: 100 });
  const earlier = commits
    .map((c) => c.sha)
    .filter((s) => s !== opts.sha)
    .reverse()
    .slice(0, FALLBACK_COMMITS);
  for (const sha of earlier) {
    const found = await deploymentForSha(octokit, owner, repo, sha, opts.environment);
    if (found) return { ...found, exact: false };
  }
  return null;
}

/** Open pull requests that contain a commit (for deployment events, which only name the commit). */
export async function pullsForCommit(octokit: Octokit, repoFullName: string, sha: string): Promise<{ number: number; branch: string; title: string; draft: boolean }[]> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: sha });
  return data.filter((p) => p.state === "open" && p.head.sha === sha).map((p) => ({ number: p.number, branch: p.head.ref, title: p.title, draft: Boolean(p.draft) }));
}

/**
 * The environment the repository's pull request instances are deployed to: the
 * non-production environment with the most recent deployments (transient ones first).
 */
export async function suggestPreviewEnvironment(octokit: Octokit, repoFullName: string): Promise<string | null> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.listDeployments({ owner, repo, per_page: 50 });
  const score = new Map<string, number>();
  for (const d of data) {
    if (d.production_environment) continue;
    score.set(d.environment, (score.get(d.environment) ?? 0) + (d.transient_environment ? 2 : 1));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Names of the repository's GitHub environments, for the settings form. */
export async function listEnvironmentNames(octokit: Octokit, repoFullName: string): Promise<string[]> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.getAllEnvironments({ owner, repo, per_page: 100 });
  return (data.environments ?? []).map((e) => e.name);
}
