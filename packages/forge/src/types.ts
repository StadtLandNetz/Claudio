import type { Provider } from "@claudio/core";

/**
 * What Claudio needs from a code host (GitHub or GitLab). One instance is bound
 * to a provider and a token: a person's OAuth token or Claudio's own bot identity.
 * Pull requests and merge requests are both "changes" here; their number is the
 * PR number on GitHub and the MR iid on GitLab.
 */
export interface Forge {
  readonly provider: Provider;
  /** Whose token this is: a signed-in person, or Claudio's bot identity (GitHub App, GitLab bot user). */
  readonly actor: "user" | "bot";
  /** Removes the token from a text (error messages of git, logs). */
  redact(text: string): string;

  // ---- account
  currentUser(): Promise<ForgeUser>;
  /** Repositories the token's owner can work on, most recently active first. */
  listUserRepos(max?: number): Promise<RepoSummary[]>;
  getRepoInfo(fullName: string): Promise<RepoInfo>;
  /** The token owner's level on a repository: 403/404 are "none", an expired token throws ForgeAuthError. */
  getAccessLevel(repo: RepoRef): Promise<AccessLevel>;

  // ---- reading
  getDefaultBranch(repo: RepoRef): Promise<string>;
  getBranchHead(repo: RepoRef, branch: string): Promise<string>;
  listOpenChanges(repo: RepoRef, limit?: number): Promise<ChangeSummary[]>;
  getChange(repo: RepoRef, number: number): Promise<ChangeSummary & { open: boolean }>;
  /** Everything a review needs: title, description, diff and the linked issues. */
  fetchChangeContext(repo: RepoRef, number: number, opts?: { maxPatchChars?: number }): Promise<ChangeContext>;
  /** Open changes whose head is this commit (deployment events only name the commit). */
  changesForCommit(repo: RepoRef, sha: string): Promise<{ number: number; branch: string; title: string; draft: boolean }[]>;
  changedFilesBetween(repo: RepoRef, base: string, head: string): Promise<ChangedSince>;
  /** How to clone the repository with this token; `publicUrl` is what the checkout keeps as its remote. */
  cloneSpec(repo: RepoRef): Promise<CloneSpec>;

  // ---- writing
  postComment(repo: RepoRef, number: number, body: string): Promise<string>;
  /**
   * Posts Claudio's result as a review. With `requestChanges` it asks for changes
   * where the host can; otherwise it withdraws Claudio's earlier change request.
   */
  postReview(repo: RepoRef, number: number, body: string, requestChanges: boolean, supersededMessage: string): Promise<{ url: string; requestedChanges: boolean }>;
  reactToComment(repo: RepoRef, number: number, commentId: number): Promise<void>;
  setCommitStatus(repo: RepoRef, sha: string, state: CommitState, description: string, opts?: { targetUrl?: string; ref?: string }): Promise<void>;
  createIssue(repo: RepoRef, issue: { title: string; body: string }): Promise<{ number: number; url: string }>;

  // ---- webhooks
  createWebhook(repo: RepoRef, url: string, secret: string): Promise<number>;
  deleteWebhook(repo: RepoRef, hookId: number): Promise<void>;
  getWebhook(repo: RepoRef, hookId: number): Promise<WebhookInfo>;
  /** Subscribes an existing webhook to events added in later Claudio versions. */
  ensureWebhookEvents(repo: RepoRef, hookId: number): Promise<void>;

  // ---- review instances
  findPreviewDeployment(repo: RepoRef, opts: { sha: string; number?: number; environment?: string }): Promise<PreviewDeployment | null>;
  suggestPreviewEnvironment(repo: RepoRef): Promise<string | null>;
  listEnvironmentNames(repo: RepoRef): Promise<string[]>;

  // ---- repository start page
  recentBranches(repo: RepoRef, first?: number): Promise<{ defaultBranch: string | null; branches: ForgeBranch[] }>;
  /** Commits per contributor and week; throws StatsPending while the host is still computing them. */
  contributorWeeks(repo: RepoRef): Promise<ContributorWeeks[]>;
}

/** Signing in with a provider. */
export interface OAuthProvider {
  readonly provider: Provider;
  configured(): boolean;
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  fetchUser(token: string): Promise<ForgeUser>;
  /** Lower-cased organisations (GitHub) or group paths (GitLab) the person belongs to, for the sign-in allowlist. */
  memberships(token: string): Promise<string[]>;
  /** Where a person reviews what Claudio may access (GitHub: the OAuth grant, for organisations with restrictions). */
  grantUrl(): string | null;
}

/** A repository as stored by Claudio. GitLab calls use the project id when it is known, so renames do not break them. */
export type RepoRef = { fullName: string; externalId?: number | null };

export type AccessLevel = "none" | "read" | "write" | "admin";

export type ForgeUser = { externalId: number; login: string; name: string | null; avatarUrl: string | null };

/** OAuth tokens. Expiry fields are set when the provider issues expiring tokens (always on GitLab). */
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt?: Date };

export type RepoSummary = {
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  /** Owner on GitHub, group path on GitLab. */
  owner: string;
  externalId?: number | null;
};

export type RepoInfo = { fullName: string; externalId: number | null; isPrivate: boolean; defaultBranch: string; canWrite: boolean };

export type ChangeSummary = {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  headSha?: string;
  draft: boolean;
  updatedAt: string;
  createdAt?: string;
  url: string;
};

export type ChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previousFilename?: string;
};

export type LinkedIssue = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: string;
};

/** A pull or merge request with its diff and linked issues. `owner`/`repo` are the namespace and the name. */
export type ChangeContext = {
  /** Absent in older stored contexts and the demo fixture: GitHub. */
  provider?: Provider;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author?: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  draft: boolean;
  files: ChangedFile[];
  issues: LinkedIssue[];
};
/** The GitHub name of a change context, kept for the code and fixtures that use it. */
export type PullRequestContext = ChangeContext;

export type ChangedSince = { files: { filename: string; status: string }[]; totalCommits: number; truncated: boolean };

export type CloneSpec = { url: string; publicUrl: string; secret: string };

/**
 * "running" is a review that waits for its regression tests. GitHub has no such
 * state and shows it as pending; GitLab refuses to set the same state twice.
 */
export type CommitState = "pending" | "running" | "success" | "failure" | "error";

export type WebhookInfo = {
  active: boolean;
  url: string;
  events: string[];
  /** Subscribed to every event this Claudio version uses. */
  complete: boolean;
  /** Last delivery as the host reports it; null when it reports none. */
  lastDelivery: { code: number | null; message: string | null } | null;
  /** The host switched the hook off after failed deliveries. */
  disabled: boolean;
};

/** A running review instance of a change, as recorded in the host's deployments. */
export type PreviewDeployment = {
  url: string;
  environment: string;
  /** Commit the instance was deployed from. */
  sha: string;
  /** False when the head commit has no instance yet and an earlier commit's instance is used. */
  exact: boolean;
  deployedAt: string;
};

export type ForgeBranch = { name: string; sha: string; committedAt: string | null; author: string | null; openPulls: number };

export type ContributorWeeks = { login: string; avatarUrl: string | null; weeks: { w: number; c: number; a: number; d: number }[] };

/** An API error with the HTTP status, like Octokit's. */
export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}

/** The host rejected the token (expired or revoked): the person must sign in again. */
export class ForgeAuthError extends ForgeError {
  constructor(message = "token rejected") {
    super(message, 401);
    this.name = "ForgeAuthError";
  }
}

/** Thrown while the host is still computing statistics; asking again a little later gets them. */
export class StatsPending extends Error {
  constructor() {
    super("The statistics are still being computed");
    this.name = "StatsPending";
  }
}

export const statusOf = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;
