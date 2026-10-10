/** Extracts GitHub issue numbers linked from a PR body and its head branch name. */
export function extractLinkedIssueNumbers(body: string | null | undefined, headRef?: string): number[] {
  const found = new Set<number>();
  const text = body ?? "";
  // closes #12, fixes #12, resolves #12 (case-insensitive), and owner/repo#12 forms
  const keyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;
  for (const m of text.matchAll(keyword)) found.add(Number(m[1]));
  // plain #12 references in the body
  for (const m of text.matchAll(/(?:^|[\s(])#(\d+)\b/g)) found.add(Number(m[1]));
  // issue links
  for (const m of text.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/g)) found.add(Number(m[1]));
  // branch names like 123-feature, feature/123-foo, issue-123
  if (headRef) {
    const b = headRef.match(/(?:^|[\/_-])(?:issue-?)?(\d{1,6})(?=[\/_-]|$)/);
    if (b) found.add(Number(b[1]));
  }
  return [...found].filter((n) => n > 0);
}

export function parseRepo(full: string): { owner: string; repo: string } {
  const m = full.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`Invalid repository "${full}", expected owner/name`);
  return { owner: m[1]!, repo: m[2]! };
}
