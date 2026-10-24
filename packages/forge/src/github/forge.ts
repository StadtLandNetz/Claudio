import { Octokit } from "octokit";
import {
  ForgeAuthError,
  StatsPending,
  statusOf,
  type AccessLevel,
  type ChangeSummary,
  type CommitState,
  type ContributorWeeks,
  type Forge,
  type ForgeBranch,
  type ForgeUser,
  type RepoInfo,
  type RepoRef,
  type RepoSummary,
  type WebhookInfo,
} from "../types.js";
import {
  WEBHOOK_EVENTS,
  addWebhookEvents,
  changedFilesBetween,
  createRepoWebhook,
  deleteRepoWebhook,
  fetchPullRequestContext,
  getBranchHead,
  getDefaultBranch,
  getRepoWebhook,
  postPullRequestComment,
  postPullRequestReview,
  reactToComment,
  setCommitStatus,
} from "./client.js";
import { findPreviewDeployment, listEnvironmentNames, pullsForCommit, suggestPreviewEnvironment } from "./deployments.js";
import { parseRepo } from "./links.js";

/** Maps GitHub's repository permissions onto Claudio's levels. */
export function githubLevel(p: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean } | undefined): AccessLevel {
  if (p?.admin) return "admin";
  if (p?.maintain || p?.push) return "write";
  if (p?.pull) return "read";
  return "none";
}

/**
 * GitHub through Octokit, with a person's OAuth token or the GitHub App's
 * installation token. `token` returns the raw token, for cloning.
 */
export class GithubForge implements Forge {
  readonly provider = "github" as const;
  /** Every token this instance handed out, so redact() can hide them. */
  private readonly secrets = new Set<string>();

  constructor(
    readonly octokit: Octokit,
    readonly actor: "user" | "bot",
    private readonly token: () => Promise<string>,
  ) {}

  static withToken(token: string): GithubForge {
    const forge = new GithubForge(new Octokit({ auth: token }), "user", async () => token);
    forge.secrets.add(token);
    return forge;
  }

  redact(text: string): string {
    let out = text;
    for (const s of this.secrets) out = out.split(s).join("***");
    return out;
  }

  async currentUser(): Promise<ForgeUser> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return { externalId: data.id, login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
  }

  /** All repos the user can access (own, collaborator, org member), most recently pushed first. */
  async listUserRepos(max = 500): Promise<RepoSummary[]> {
    const out: RepoSummary[] = [];
    for await (const { data } of this.octokit.paginate.iterator(this.octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: "pushed",
      affiliation: "owner,collaborator,organization_member",
    })) {
      for (const r of data) {
        out.push({
          fullName: r.full_name,
          description: r.description,
          isPrivate: r.private,
          defaultBranch: r.default_branch,
          pushedAt: r.pushed_at ?? null,
          owner: r.owner.login,
        });
      }
      if (out.length >= max) break;
    }
    return out;
  }

  async getRepoInfo(fullName: string): Promise<RepoInfo> {
    const { owner, repo } = parseRepo(fullName);
    const { data } = await this.octokit.rest.repos.get({ owner, repo });
    return {
      fullName: data.full_name,
      externalId: null,
      isPrivate: data.private,
      defaultBranch: data.default_branch,
      canWrite: Boolean(data.permissions?.push || data.permissions?.maintain || data.permissions?.admin),
    };
  }

  async getAccessLevel(repo: RepoRef): Promise<AccessLevel> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo: name });
      return githubLevel(data.permissions);
    } catch (e) {
      const status = statusOf(e);
      if (status === 401) throw new ForgeAuthError();
      // GitHub hides private repositories without access behind 404.
      if (status === 404 || status === 403) return "none";
      throw e;
    }
  }

  getDefaultBranch(repo: RepoRef): Promise<string> {
    return getDefaultBranch(this.octokit, repo.fullName);
  }

  getBranchHead(repo: RepoRef, branch: string): Promise<string> {
    return getBranchHead(this.octokit, repo.fullName, branch);
  }

  async listOpenChanges(repo: RepoRef, limit = 50): Promise<ChangeSummary[]> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    const { data } = await this.octokit.rest.pulls.list({ owner, repo: name, state: "open", sort: "updated", direction: "desc", per_page: limit });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? null,
      headRef: p.head.ref,
      headSha: p.head.sha,
      draft: Boolean(p.draft),
      updatedAt: p.updated_at,
      createdAt: p.created_at,
      url: p.html_url,
    }));
  }

  async getChange(repo: RepoRef, number: number): Promise<ChangeSummary & { open: boolean }> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    const { data: p } = await this.octokit.rest.pulls.get({ owner, repo: name, pull_number: number });
    return {
      number: p.number,
      title: p.title,
      author: p.user?.login ?? null,
      headRef: p.head.ref,
      headSha: p.head.sha,
      draft: Boolean(p.draft),
      updatedAt: p.updated_at,
      url: p.html_url,
      open: p.state === "open",
    };
  }

  fetchChangeContext(repo: RepoRef, number: number, opts?: { maxPatchChars?: number }) {
    return fetchPullRequestContext(this.octokit, repo.fullName, number, opts);
  }

  changesForCommit(repo: RepoRef, sha: string) {
    return pullsForCommit(this.octokit, repo.fullName, sha);
  }

  changedFilesBetween(repo: RepoRef, base: string, head: string) {
    return changedFilesBetween(this.octokit, repo.fullName, base, head);
  }

  async cloneSpec(repo: RepoRef) {
    const token = await this.token();
    this.secrets.add(token);
    return { url: `https://x-access-token:${token}@github.com/${repo.fullName}.git`, publicUrl: `https://github.com/${repo.fullName}.git`, secret: token };
  }

  postComment(repo: RepoRef, number: number, body: string): Promise<string> {
    return postPullRequestComment(this.octokit, repo.fullName, number, body);
  }

  postReview(repo: RepoRef, number: number, body: string, requestChanges: boolean, supersededMessage: string) {
    return postPullRequestReview(this.octokit, repo.fullName, number, body, requestChanges, supersededMessage);
  }

  reactToComment(repo: RepoRef, _number: number, commentId: number): Promise<void> {
    return reactToComment(this.octokit, repo.fullName, commentId);
  }

  setCommitStatus(repo: RepoRef, sha: string, state: CommitState, description: string, opts: { targetUrl?: string } = {}): Promise<void> {
    // GitHub has no "running": a review waiting for its tests is still pending.
    return setCommitStatus(this.octokit, repo.fullName, sha, state === "running" ? "pending" : state, description, opts.targetUrl);
  }

  async createIssue(repo: RepoRef, issue: { title: string; body: string }): Promise<{ number: number; url: string }> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    const { data } = await this.octokit.rest.issues.create({ owner, repo: name, title: issue.title, body: issue.body });
    return { number: data.number, url: data.html_url };
  }

  createWebhook(repo: RepoRef, url: string, secret: string): Promise<number> {
    return createRepoWebhook(this.octokit, repo.fullName, url, secret);
  }

  deleteWebhook(repo: RepoRef, hookId: number): Promise<void> {
    return deleteRepoWebhook(this.octokit, repo.fullName, hookId);
  }

  async getWebhook(repo: RepoRef, hookId: number): Promise<WebhookInfo> {
    const hook = await getRepoWebhook(this.octokit, repo.fullName, hookId);
    const code = hook.lastResponse?.code ?? null;
    return {
      active: hook.active,
      url: hook.url,
      events: hook.events,
      complete: WEBHOOK_EVENTS.every((e) => hook.events.includes(e)),
      lastDelivery: code === null ? null : { code, message: hook.lastResponse?.message ?? null },
      disabled: !hook.active,
    };
  }

  ensureWebhookEvents(repo: RepoRef, hookId: number): Promise<void> {
    return addWebhookEvents(this.octokit, repo.fullName, hookId);
  }

  findPreviewDeployment(repo: RepoRef, opts: { sha: string; number?: number; environment?: string }) {
    return findPreviewDeployment(this.octokit, repo.fullName, { sha: opts.sha, prNumber: opts.number, environment: opts.environment });
  }

  suggestPreviewEnvironment(repo: RepoRef): Promise<string | null> {
    return suggestPreviewEnvironment(this.octokit, repo.fullName);
  }

  listEnvironmentNames(repo: RepoRef): Promise<string[]> {
    return listEnvironmentNames(this.octokit, repo.fullName);
  }

  /** The most recently committed branches (one GraphQL call), with whether an open pull request belongs to each. */
  async recentBranches(repo: RepoRef, first = 50): Promise<{ defaultBranch: string | null; branches: ForgeBranch[] }> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    type Node = {
      name: string;
      associatedPullRequests: { totalCount: number };
      target: { oid?: string; committedDate?: string; author?: { name: string | null; user: { login: string } | null } | null } | null;
    };
    const data = await this.octokit.graphql<{ repository: { defaultBranchRef: { name: string } | null; refs: { nodes: Node[] } } }>(
      `query($owner: String!, $name: String!, $first: Int!) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef { name }
          refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
            nodes {
              name
              associatedPullRequests(states: OPEN) { totalCount }
              target { ... on Commit { oid committedDate author { name user { login } } } }
            }
          }
        }
      }`,
      { owner, name, first },
    );
    return {
      defaultBranch: data.repository.defaultBranchRef?.name ?? null,
      branches: data.repository.refs.nodes.map((n) => ({
        name: n.name,
        sha: n.target?.oid ?? "",
        committedAt: n.target?.committedDate ?? null,
        author: n.target?.author?.user?.login ?? n.target?.author?.name ?? null,
        openPulls: n.associatedPullRequests.totalCount,
      })),
    };
  }

  /** Commits, additions and deletions per contributor and week (unix seconds of the week's Sunday), from GitHub's statistics. */
  async contributorWeeks(repo: RepoRef): Promise<ContributorWeeks[]> {
    const { owner, repo: name } = parseRepo(repo.fullName);
    const res = await this.octokit.rest.repos.getContributorsStats({ owner, repo: name });
    if ((res.status as number) === 202 || !Array.isArray(res.data)) throw new StatsPending();
    return res.data.map((c) => ({
      login: c.author?.login ?? "?",
      avatarUrl: c.author?.avatar_url ?? null,
      weeks: (c.weeks ?? []).map((w) => ({ w: w.w ?? 0, c: w.c ?? 0, a: w.a ?? 0, d: w.d ?? 0 })),
    }));
  }
}
