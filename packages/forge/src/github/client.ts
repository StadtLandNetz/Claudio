import { Octokit } from "octokit";
import { extractLinkedIssueNumbers, parseRepo } from "./links.js";

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

export type PullRequestContext = {
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

export function createGithubClient(token: string | undefined = process.env.GITHUB_TOKEN): Octokit {
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return new Octokit({ auth: token });
}

export async function fetchPullRequestContext(
  octokit: Octokit,
  repoFullName: string,
  number: number,
  opts: { maxPatchChars?: number } = {},
): Promise<PullRequestContext> {
  const { owner, repo } = parseRepo(repoFullName);
  const maxPatchChars = opts.maxPatchChars ?? 12_000;
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number: number, per_page: 100 });

  const issueNumbers = extractLinkedIssueNumbers(pr.body, pr.head.ref).filter((n) => n !== number);
  const issues: LinkedIssue[] = [];
  for (const n of issueNumbers) {
    try {
      const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: n });
      if (data.pull_request) continue; // a PR reference, not an issue
      issues.push({
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        url: data.html_url,
        labels: data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
        state: data.state,
      });
    } catch {
      // Unresolvable reference (deleted issue, no access): skip silently, the reviewer will see fewer issues.
    }
  }

  return {
    owner,
    repo,
    number,
    title: pr.title,
    body: pr.body ?? "",
    url: pr.html_url,
    author: pr.user?.login,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    draft: Boolean(pr.draft),
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? truncate(f.patch, maxPatchChars) : undefined,
      previousFilename: f.previous_filename,
    })),
    issues,
  };
}

export async function postPullRequestComment(octokit: Octokit, repoFullName: string, number: number, body: string): Promise<string> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
  return data.html_url;
}

/** Claudio's PR texts start with this, so its own earlier reviews can be told apart from people's. */
const CLAUDIO_MARKER = "Claudio Review";

/**
 * Posts Claudio's result as a pull request review. With blocking findings it
 * requests changes (GitHub then shows "Changes requested" instead of a failed
 * check); otherwise it is a plain review comment, and Claudio's own earlier change
 * requests on the PR are dismissed so they no longer block. GitHub forbids
 * requesting changes on your own PR; then the review is posted as a comment.
 */
export async function postPullRequestReview(
  octokit: Octokit,
  repoFullName: string,
  number: number,
  body: string,
  requestChanges: boolean,
  dismissMessage = "Superseded by a newer Claudio review.",
): Promise<{ url: string; requestedChanges: boolean }> {
  const { owner, repo } = parseRepo(repoFullName);
  const post = async (event: "REQUEST_CHANGES" | "COMMENT") =>
    (await octokit.rest.pulls.createReview({ owner, repo, pull_number: number, body, event })).data.html_url;
  if (!requestChanges) {
    await dismissOwnChangeRequests(octokit, owner, repo, number, dismissMessage).catch(() => undefined);
    return { url: await post("COMMENT"), requestedChanges: false };
  }
  try {
    return { url: await post("REQUEST_CHANGES"), requestedChanges: true };
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
    return { url: await post("COMMENT"), requestedChanges: false };
  }
}

async function dismissOwnChangeRequests(octokit: Octokit, owner: string, repo: string, number: number, message: string): Promise<void> {
  const { data: me } = await octokit.rest.users.getAuthenticated();
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 });
  for (const r of reviews) {
    if (r.state === "CHANGES_REQUESTED" && r.user?.login === me.login && r.body?.includes(CLAUDIO_MARKER)) {
      await octokit.rest.pulls.dismissReview({ owner, repo, pull_number: number, review_id: r.id, message });
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}

export async function getDefaultBranch(octokit: Octokit, repoFullName: string): Promise<string> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return data.default_branch;
}

export async function getBranchHead(octokit: Octokit, repoFullName: string, branch: string): Promise<string> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch });
  return data.commit.sha;
}

export type ChangedSince = { files: { filename: string; status: string }[]; totalCommits: number; truncated: boolean };

/** Files changed between two commits (GitHub caps the list at 300 files). */
export async function changedFilesBetween(octokit: Octokit, repoFullName: string, base: string, head: string): Promise<ChangedSince> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}`, per_page: 100 });
  const files = (data.files ?? []).map((f) => ({ filename: f.filename, status: f.status }));
  return { files, totalCommits: data.total_commits, truncated: files.length >= 300 };
}

export const WEBHOOK_EVENTS = ["pull_request", "issue_comment", "push", "deployment_status"];

/** Creates the repository webhook that sends PR, comment, push and deployment events to Claudio. Returns the hook id. */
export async function createRepoWebhook(octokit: Octokit, repoFullName: string, url: string, secret: string): Promise<number> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.createWebhook({
    owner,
    repo,
    name: "web",
    active: true,
    events: WEBHOOK_EVENTS,
    config: { url, content_type: "json", secret, insecure_ssl: "0" },
  });
  return data.id;
}

export async function deleteRepoWebhook(octokit: Octokit, repoFullName: string, hookId: number): Promise<void> {
  const { owner, repo } = parseRepo(repoFullName);
  await octokit.rest.repos.deleteWebhook({ owner, repo, hook_id: hookId }).catch((e: { status?: number }) => {
    if (e.status !== 404) throw e;
  });
}

/** Last delivery status of the webhook, for the settings page. */
export async function getRepoWebhook(octokit: Octokit, repoFullName: string, hookId: number) {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.repos.getWebhook({ owner, repo, hook_id: hookId });
  return { active: data.active, url: data.config.url ?? "", lastResponse: data.last_response, events: data.events };
}

/** Subscribes an existing webhook to events added in later Claudio versions. */
export async function addWebhookEvents(octokit: Octokit, repoFullName: string, hookId: number, events: string[] = WEBHOOK_EVENTS): Promise<void> {
  const { owner, repo } = parseRepo(repoFullName);
  await octokit.rest.repos.updateWebhook({ owner, repo, hook_id: hookId, add_events: events });
}

export type CommitState = "pending" | "success" | "failure" | "error";

/** Sets the "Claudio" status on a commit; GitHub shows it in the PR's checks and branch protection can require it. */
export async function setCommitStatus(octokit: Octokit, repoFullName: string, sha: string, state: CommitState, description: string, targetUrl?: string): Promise<void> {
  const { owner, repo } = parseRepo(repoFullName);
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: "Claudio",
    description: description.slice(0, 140),
    target_url: targetUrl,
  });
}

export async function reactToComment(octokit: Octokit, repoFullName: string, commentId: number, content: "eyes" | "rocket" = "eyes"): Promise<void> {
  const { owner, repo } = parseRepo(repoFullName);
  await octokit.rest.reactions.createForIssueComment({ owner, repo, comment_id: commentId, content });
}

export async function getPullHead(octokit: Octokit, repoFullName: string, number: number): Promise<{ sha: string; branch: string; title: string; open: boolean }> {
  const { owner, repo } = parseRepo(repoFullName);
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  return { sha: data.head.sha, branch: data.head.ref, title: data.title, open: data.state === "open" };
}
