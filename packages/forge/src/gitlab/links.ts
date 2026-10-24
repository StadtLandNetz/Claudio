import type { AccessLevel } from "../types.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Issue numbers (iids) a merge request refers to in its description and its
 * branch name, within its own project. Merge requests (!12) and other projects'
 * issues (group/other#12) do not count.
 */
export function extractGitlabIssueRefs(body: string | null | undefined, headRef: string | undefined, project: { fullName: string; host: string }): number[] {
  const found = new Set<number>();
  const text = body ?? "";
  // #12, closes #12, (#12); not other#12, !12 or a URL fragment.
  for (const m of text.matchAll(/(?:^|[^\w/#!.&-])#(\d+)\b/g)) found.add(Number(m[1]));
  // this project's own full reference: group/project#12
  for (const m of text.matchAll(new RegExp(`(?:^|[\\s(])${escape(project.fullName)}#(\\d+)\\b`, "gi"))) found.add(Number(m[1]));
  // links to this project's issues or work items
  const links = new RegExp(`https?://${escape(project.host)}/${escape(project.fullName)}/-/(?:issues|work_items)/(\\d+)`, "gi");
  for (const m of text.matchAll(links)) found.add(Number(m[1]));
  // GitLab names a branch created from an issue "12-title"; also feature/12-foo and issue-12
  if (headRef) {
    const b = headRef.match(/(?:^|[/_-])(?:issue-?)?(\d{1,6})(?=[/_-]|$)/);
    if (b) found.add(Number(b[1]));
  }
  return [...found].filter((n) => n > 0);
}

/**
 * Maps GitLab's role (10 guest, 20 reporter, 30 developer, 40 maintainer,
 * 50 owner) onto Claudio's levels. Without a role that can read the code,
 * public and internal projects are still readable when their repository is.
 */
export function gitlabLevel(accessLevel: number, project: { visibility?: string; repository_access_level?: string }): AccessLevel {
  if (accessLevel >= 40) return "admin";
  if (accessLevel >= 30) return "write";
  if (accessLevel >= 20) return "read";
  const open = project.visibility === "public" || project.visibility === "internal";
  return open && (project.repository_access_level ?? "enabled") === "enabled" ? "read" : "none";
}

/** Added and removed lines of one file's diff (GitLab sends the hunks without file headers). */
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/** GitHub's file status names, which the prompts and reports use. */
export function fileStatus(d: { new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean }): string {
  if (d.new_file) return "added";
  if (d.deleted_file) return "removed";
  if (d.renamed_file) return "renamed";
  return "modified";
}
