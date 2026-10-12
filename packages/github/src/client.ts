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
