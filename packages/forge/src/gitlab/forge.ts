import { envMatches, splitRepo } from "@claudio/core";
import {
  statusOf,
  type AccessLevel,
  type ChangeContext,
  type ChangeSummary,
  type ChangedSince,
  type CloneSpec,
  type CommitState,
  type ContributorWeeks,
  type Forge,
  type ForgeBranch,
  type ForgeUser,
  type LinkedIssue,
  type PreviewDeployment,
  type RepoInfo,
  type RepoRef,
  type RepoSummary,
  type WebhookInfo,
} from "../types.js";
import { GitlabHttp, projectId } from "./http.js";
import { countDiffLines, extractGitlabIssueRefs, fileStatus, gitlabLevel } from "./links.js";

// ---- the parts of GitLab's API answers Claudio reads

type GlUser = { id: number; username: string; name?: string | null; avatar_url?: string | null };
type GlProject = {
  id: number;
  path_with_namespace: string;
  description?: string | null;
  visibility?: string;
  default_branch?: string | null;
  last_activity_at?: string | null;
  web_url?: string;
  namespace?: { full_path?: string };
  repository_access_level?: string;
  permissions?: { project_access?: { access_level: number } | null; group_access?: { access_level: number } | null };
};
type GlMergeRequest = {
  iid: number;
  title: string;
  description?: string | null;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  target_branch: string;
  sha: string;
  web_url: string;
  author?: GlUser | null;
  updated_at: string;
  created_at?: string;
  source_project_id?: number;
  target_project_id?: number;
};
type GlDiff = { old_path: string; new_path: string; new_file?: boolean; renamed_file?: boolean; deleted_file?: boolean; diff?: string; too_large?: boolean; collapsed?: boolean };
type GlIssue = { iid: number; title: string; description?: string | null; web_url: string; labels?: string[]; state: string };
type GlNote = { id: number; body: string; system?: boolean; author?: GlUser };
type GlHook = { id: number; url: string; merge_requests_events?: boolean; note_events?: boolean; push_events?: boolean; deployment_events?: boolean; alert_status?: string };
type GlDeployment = { sha: string; status: string; updated_at?: string; created_at: string; environment?: { name: string; external_url?: string | null; tier?: string; state?: string } };
type GlEnvironment = { name: string; tier?: string; state?: string; external_url?: string | null };

/** The project webhook's events, as GitLab's flags. */
export const GITLAB_HOOK_EVENTS = ["merge_requests_events", "note_events", "push_events", "deployment_events"] as const;

/** GitLab knows no "error"; "running" exists, and setting a state a second time is refused. */
export function gitlabStatusState(state: CommitState): "pending" | "running" | "success" | "failed" {
  return state === "failure" || state === "error" ? "failed" : state;
}

/** Unix seconds of the Sunday (00:00 UTC) that starts the week of `iso`, like GitHub's contributor statistics. */
export const weekStart = (iso: string): number => {
  const day = Math.floor(Date.parse(iso) / 86_400_000);
  // 1970-01-01 was a Thursday: weekday 0 is Sunday.
  const weekday = (((day + 4) % 7) + 7) % 7;
  return (day - weekday) * 86_400;
};

/**
 * GitLab (gitlab.com or self-managed) with a person's OAuth token or Claudio's
 * bot token. Projects are addressed by id where known, else by their path.
 */
export class GitlabForge implements Forge {
  readonly provider = "gitlab" as const;
  readonly http: GitlabHttp;
  private user: Promise<GlUser> | undefined;

  constructor(
    token: string,
    readonly actor: "user" | "bot" = "user",
    opts: { fetch?: typeof fetch; baseUrl?: string } = {},
  ) {
    this.http = new GitlabHttp(token, opts.fetch, opts.baseUrl);
  }

  redact(text: string): string {
    return text.split(this.http.token).join("***");
  }

  private me(): Promise<GlUser> {
    this.user ??= this.http.get<GlUser>("/user").catch((e) => {
      this.user = undefined;
      throw e;
    });
    return this.user;
  }

  private project(repo: RepoRef): Promise<GlProject> {
    return this.http.get<GlProject>(`/projects/${projectId(repo)}`);
  }

  private mrPath(repo: RepoRef, number: number): string {
    return `/projects/${projectId(repo)}/merge_requests/${number}`;
  }

  /** Link to a note; GitLab answers notes without their URL. */
  private noteUrl(repo: RepoRef, number: number, noteId: number): string {
    return `${this.http.baseUrl}/${repo.fullName}/-/merge_requests/${number}#note_${noteId}`;
  }

  // ---- account

  async currentUser(): Promise<ForgeUser> {
    const u = await this.me();
    return { externalId: u.id, login: u.username, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
  }

  /** Projects the person is a member of with at least reporter access, most recently active first. */
  async listUserRepos(max = 500): Promise<RepoSummary[]> {
    const projects = await this.http.paginate<GlProject>("/projects", { membership: true, min_access_level: 20, order_by: "last_activity_at", sort: "desc", archived: false }, max);
    return projects.map((p) => ({
      fullName: p.path_with_namespace,
      description: p.description ?? null,
      isPrivate: p.visibility !== "public",
      defaultBranch: p.default_branch ?? "main",
      pushedAt: p.last_activity_at ?? null,
      owner: p.namespace?.full_path ?? splitRepo(p.path_with_namespace).namespace,
      externalId: p.id,
    }));
  }

  async getRepoInfo(fullName: string): Promise<RepoInfo> {
    const p = await this.project({ fullName });
    const level = await this.levelOn(p);
    return { fullName: p.path_with_namespace, externalId: p.id, isPrivate: p.visibility !== "public", defaultBranch: p.default_branch ?? "main", canWrite: level === "write" || level === "admin" };
  }

  async getAccessLevel(repo: RepoRef): Promise<AccessLevel> {
    try {
      return await this.levelOn(await this.project(repo));
    } catch (e) {
      // GitLab answers 404 for projects one may not see.
      if (statusOf(e) === 404 || statusOf(e) === 403) return "none";
      throw e;
    }
  }

  /** The role on a project, including what is inherited from parent groups and shared groups. */
  private async levelOn(p: GlProject): Promise<AccessLevel> {
    let access = Math.max(p.permissions?.project_access?.access_level ?? 0, p.permissions?.group_access?.access_level ?? 0);
    if (access < 50) {
      const me = await this.me();
      const member = await this.http.get<{ access_level: number }>(`/projects/${p.id}/members/all/${me.id}`).catch((e) => {
        if (statusOf(e) === 404) return null;
        throw e;
      });
      access = Math.max(access, member?.access_level ?? 0);
    }
    return gitlabLevel(access, p);
  }

  // ---- reading

  async getDefaultBranch(repo: RepoRef): Promise<string> {
    return (await this.project(repo)).default_branch ?? "main";
  }

  async getBranchHead(repo: RepoRef, branch: string): Promise<string> {
    const b = await this.http.get<{ commit: { id: string } }>(`/projects/${projectId(repo)}/repository/branches/${encodeURIComponent(branch)}`);
    return b.commit.id;
  }

  private summary(mr: GlMergeRequest): ChangeSummary {
    return {
      number: mr.iid,
      title: mr.title,
      author: mr.author?.username ?? null,
      headRef: mr.source_branch,
      headSha: mr.sha,
      draft: Boolean(mr.draft ?? mr.work_in_progress),
      updatedAt: mr.updated_at,
      createdAt: mr.created_at,
      url: mr.web_url,
    };
  }

  async listOpenChanges(repo: RepoRef, limit = 50): Promise<ChangeSummary[]> {
    const mrs = await this.http.get<GlMergeRequest[]>(`/projects/${projectId(repo)}/merge_requests`, { state: "opened", order_by: "updated_at", sort: "desc", per_page: limit });
    return mrs.map((mr) => this.summary(mr));
  }

  async getChange(repo: RepoRef, number: number): Promise<ChangeSummary & { open: boolean }> {
    const mr = await this.http.get<GlMergeRequest>(this.mrPath(repo, number));
    return { ...this.summary(mr), open: mr.state === "opened" };
  }

  async fetchChangeContext(repo: RepoRef, number: number, opts: { maxPatchChars?: number } = {}): Promise<ChangeContext> {
    const maxPatchChars = opts.maxPatchChars ?? 12_000;
    const mr = await this.http.get<GlMergeRequest>(this.mrPath(repo, number));
    const diffs = await this.http.paginate<GlDiff>(`${this.mrPath(repo, number)}/diffs`).catch(async (e) => {
      // Before GitLab 15.7 the diffs came with /changes.
      if (statusOf(e) !== 404) throw e;
      return (await this.http.get<{ changes: GlDiff[] }>(`${this.mrPath(repo, number)}/changes`)).changes;
    });

    // Issues the merge request closes, plus those it mentions in its description or branch name.
    const issues = new Map<number, LinkedIssue>();
    const toIssue = (i: GlIssue): LinkedIssue => ({
      number: i.iid,
      title: i.title,
      body: i.description ?? "",
      url: i.web_url,
      labels: i.labels ?? [],
      state: i.state === "opened" ? "open" : i.state,
    });
    const closes = await this.http.get<GlIssue[]>(`${this.mrPath(repo, number)}/closes_issues`).catch(() => []);
    for (const i of closes) if (i.iid) issues.set(i.iid, toIssue(i));
    const host = new URL(this.http.baseUrl).host;
    for (const n of extractGitlabIssueRefs(mr.description, mr.source_branch, { fullName: repo.fullName, host })) {
      if (issues.has(n)) continue;
      try {
        issues.set(n, toIssue(await this.http.get<GlIssue>(`/projects/${projectId(repo)}/issues/${n}`)));
      } catch {
        // Unresolvable reference (deleted issue, no access): skip silently, the reviewer will see fewer issues.
      }
    }

    const { namespace, name } = splitRepo(repo.fullName);
    return {
      provider: "gitlab",
      owner: namespace,
      repo: name,
      number,
      title: mr.title,
      body: mr.description ?? "",
      url: mr.web_url,
      author: mr.author?.username,
      headRef: mr.source_branch,
      headSha: mr.sha,
      baseRef: mr.target_branch,
      draft: Boolean(mr.draft ?? mr.work_in_progress),
      files: diffs.map((d) => {
        const patch = d.diff && !d.too_large ? d.diff : undefined;
        return {
          filename: d.new_path,
          status: fileStatus(d),
          ...countDiffLines(d.diff ?? ""),
          patch: patch && patch.length > maxPatchChars ? `${patch.slice(0, maxPatchChars)}\n... [truncated ${patch.length - maxPatchChars} chars]` : patch,
          previousFilename: d.renamed_file ? d.old_path : undefined,
        };
      }),
      issues: [...issues.values()],
    };
  }

  async changesForCommit(repo: RepoRef, sha: string) {
    const mrs = await this.http.get<GlMergeRequest[]>(`/projects/${projectId(repo)}/repository/commits/${sha}/merge_requests`);
    return mrs
      .filter((mr) => mr.state === "opened" && mr.sha === sha)
      .map((mr) => ({ number: mr.iid, branch: mr.source_branch, title: mr.title, draft: Boolean(mr.draft ?? mr.work_in_progress) }));
  }

  /** Files changed between two commits or branches (from their merge base, like GitHub's base...head). */
  async changedFilesBetween(repo: RepoRef, base: string, head: string): Promise<ChangedSince> {
    const c = await this.http.get<{ commits?: unknown[]; diffs?: GlDiff[]; compare_timeout?: boolean }>(`/projects/${projectId(repo)}/repository/compare`, { from: base, to: head, straight: false });
    const files = (c.diffs ?? []).map((d) => ({ filename: d.new_path, status: fileStatus(d) }));
    // GitLab stops at its diff limits (1000 files by default) or when comparing takes too long.
    return { files, totalCommits: c.commits?.length ?? 0, truncated: Boolean(c.compare_timeout) || files.length >= 1000 };
  }

  async cloneSpec(repo: RepoRef): Promise<CloneSpec> {
    const url = new URL(`${this.http.baseUrl}/${repo.fullName}.git`);
    const publicUrl = url.toString();
    url.username = "oauth2";
    url.password = this.http.token;
    return { url: url.toString(), publicUrl, secret: this.http.token };
  }

  // ---- writing

  async postComment(repo: RepoRef, number: number, body: string): Promise<string> {
    const note = await this.http.post<GlNote>(`${this.mrPath(repo, number)}/notes`, { body });
    return this.noteUrl(repo, number, note.id);
  }

  /**
   * With blocking findings, Claudio publishes its comment as a review that
   * requests changes (GitLab blocks merging on them in Premium and Ultimate).
   * Without, a plain comment; if Claudio had requested changes before, the
   * comment is published as a review that withdraws the request. When GitLab
   * refuses the review (older version, Claudio not allowed to review), the
   * comment is posted as a plain note, like a refused review on GitHub.
   */
  async postReview(repo: RepoRef, number: number, body: string, requestChanges: boolean): Promise<{ url: string; requestedChanges: boolean }> {
    const me = await this.me();
    const reviewers = await this.http.get<{ user?: { id: number }; state?: string }[]>(`${this.mrPath(repo, number)}/reviewers`).catch(() => []);
    const mine = reviewers.find((r) => r.user?.id === me.id);
    const state = requestChanges ? "requested_changes" : mine?.state === "requested_changes" ? "reviewed" : null;
    if (state) {
      try {
        return { url: await this.publishReview(repo, number, body, state, me.id), requestedChanges: requestChanges };
      } catch {
        // Fall back to a plain comment below.
      }
    }
    return { url: await this.postComment(repo, number, body), requestedChanges: false };
  }

  /** A review: the comment as a draft note, published together with the reviewer state. */
  private async publishReview(repo: RepoRef, number: number, body: string, state: "requested_changes" | "reviewed", myId: number): Promise<string> {
    const draft = await this.http.post<{ id: number }>(`${this.mrPath(repo, number)}/draft_notes`, { note: body });
    try {
      await this.http.post(`${this.mrPath(repo, number)}/draft_notes/bulk_publish`, { reviewer_state: state });
    } catch (e) {
      await this.http.delete(`${this.mrPath(repo, number)}/draft_notes/${draft.id}`).catch(() => undefined);
      throw e;
    }
    // Publishing answers without the note; it is Claudio's newest one.
    const notes = await this.http.get<GlNote[]>(`${this.mrPath(repo, number)}/notes`, { order_by: "created_at", sort: "desc", per_page: 20 });
    const note = notes.find((n) => !n.system && n.author?.id === myId);
    return note ? this.noteUrl(repo, number, note.id) : `${this.http.baseUrl}/${repo.fullName}/-/merge_requests/${number}`;
  }

  async reactToComment(repo: RepoRef, number: number, commentId: number): Promise<void> {
    await this.http.post(`${this.mrPath(repo, number)}/notes/${commentId}/award_emoji`, { name: "eyes" });
  }

  async setCommitStatus(repo: RepoRef, sha: string, state: CommitState, description: string, opts: { targetUrl?: string; ref?: string } = {}): Promise<void> {
    try {
      await this.http.post(`/projects/${projectId(repo)}/statuses/${sha}`, {
        state: gitlabStatusState(state),
        name: "Claudio",
        description: description.slice(0, 255),
        target_url: opts.targetUrl,
        ref: opts.ref,
      });
    } catch (e) {
      // GitLab refuses to set the state the commit already has ("Cannot transition status").
      if (statusOf(e) === 400 && /transition/i.test((e as Error).message)) return;
      throw e;
    }
  }

  async createIssue(repo: RepoRef, issue: { title: string; body: string }): Promise<{ number: number; url: string }> {
    const created = await this.http.post<GlIssue>(`/projects/${projectId(repo)}/issues`, { title: issue.title, description: issue.body });
    return { number: created.iid, url: created.web_url };
  }

  // ---- webhooks

  async createWebhook(repo: RepoRef, url: string, secret: string): Promise<number> {
    const hook = await this.http.post<GlHook>(`/projects/${projectId(repo)}/hooks`, {
      url,
      token: secret,
      enable_ssl_verification: true,
      ...Object.fromEntries(GITLAB_HOOK_EVENTS.map((e) => [e, true])),
    });
    return hook.id;
  }

  async deleteWebhook(repo: RepoRef, hookId: number): Promise<void> {
    await this.http.delete(`/projects/${projectId(repo)}/hooks/${hookId}`).catch((e) => {
      if (statusOf(e) !== 404) throw e;
    });
  }

  async getWebhook(repo: RepoRef, hookId: number): Promise<WebhookInfo> {
    const hook = await this.http.get<GlHook>(`/projects/${projectId(repo)}/hooks/${hookId}`);
    const events = GITLAB_HOOK_EVENTS.filter((e) => hook[e]);
    // The delivery log exists in newer GitLab versions only.
    const last = await this.http
      .get<{ response_status?: string | number; execution_duration?: number }[]>(`/projects/${projectId(repo)}/hooks/${hookId}/events`, { per_page: 1 })
      .then((list) => list[0] ?? null)
      .catch(() => null);
    const code = last?.response_status !== undefined ? Number(last.response_status) : null;
    const disabled = Boolean(hook.alert_status && hook.alert_status !== "executable");
    return {
      active: !disabled,
      url: hook.url,
      events: [...events],
      complete: events.length === GITLAB_HOOK_EVENTS.length,
      lastDelivery: last ? { code: Number.isFinite(code) ? code : null, message: Number.isFinite(code) ? null : String(last.response_status) } : null,
      disabled,
    };
  }

  async ensureWebhookEvents(repo: RepoRef, hookId: number): Promise<void> {
    const hook = await this.http.get<GlHook>(`/projects/${projectId(repo)}/hooks/${hookId}`);
    await this.http.put(`/projects/${projectId(repo)}/hooks/${hookId}`, { url: hook.url, ...Object.fromEntries(GITLAB_HOOK_EVENTS.map((e) => [e, true])) });
  }

  // ---- review instances

  /**
   * The live instance of a merge request: the newest successful deployment of
   * its head commit (or, failing that, of one of its 10 previous commits) to an
   * environment with an address. A configured environment also covers its
   * folder ("review" covers review/<branch>); without one, production is skipped.
   */
  async findPreviewDeployment(repo: RepoRef, opts: { sha: string; number?: number; environment?: string }): Promise<PreviewDeployment | null> {
    const deployments = await this.http.get<GlDeployment[]>(`/projects/${projectId(repo)}/deployments`, { status: "success", order_by: "updated_at", sort: "desc", per_page: 100 });
    const usable = deployments.filter((d) => {
      const env = d.environment;
      if (!env?.external_url || env.state === "stopped") return false;
      if (opts.environment) return envMatches(opts.environment, env.name);
      return env.tier !== "production" && env.name.toLowerCase() !== "production";
    });
    const at = (sha: string) => usable.find((d) => d.sha === sha);
    const deployment = (d: GlDeployment, exact: boolean): PreviewDeployment => ({
      url: d.environment!.external_url!,
      environment: d.environment!.name,
      sha: d.sha,
      exact,
      deployedAt: d.updated_at ?? d.created_at,
    });
    const exact = at(opts.sha);
    if (exact) return deployment(exact, true);
    if (!opts.number) return null;
    const commits = await this.http.get<{ id: string }[]>(`${this.mrPath(repo, opts.number)}/commits`, { per_page: 20 });
    // GitLab lists a merge request's commits newest first.
    for (const c of commits.filter((c) => c.id !== opts.sha).slice(0, 10)) {
      const found = at(c.id);
      if (found) return deployment(found, false);
    }
    return null;
  }

  /** The folder (review/…) or environment most of the non-production environments belong to. */
  async suggestPreviewEnvironment(repo: RepoRef): Promise<string | null> {
    const envs = await this.environments(repo);
    const score = new Map<string, number>();
    for (const e of envs) {
      if (e.tier === "production" || e.name.toLowerCase() === "production") continue;
      const key = e.name.includes("/") ? e.name.split("/")[0]! : e.name;
      score.set(key, (score.get(key) ?? 0) + (e.name.includes("/") ? 2 : 1));
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  /** Environment folders first (review), then the single environments. */
  async listEnvironmentNames(repo: RepoRef): Promise<string[]> {
    const names = (await this.environments(repo)).map((e) => e.name);
    const folders = [...new Set(names.filter((n) => n.includes("/")).map((n) => n.split("/")[0]!))];
    return [...folders, ...names.filter((n) => !n.includes("/"))];
  }

  private environments(repo: RepoRef): Promise<GlEnvironment[]> {
    return this.http.paginate<GlEnvironment>(`/projects/${projectId(repo)}/environments`, { states: "available" }, 300);
  }

  // ---- repository start page

  async recentBranches(repo: RepoRef, first = 50): Promise<{ defaultBranch: string | null; branches: ForgeBranch[] }> {
    const [project, branches, open] = await Promise.all([
      this.project(repo),
      this.http.get<{ name: string; commit: { id: string; committed_date?: string; author_name?: string } }[]>(`/projects/${projectId(repo)}/repository/branches`, { sort: "updated_desc", per_page: first }),
      this.http.get<GlMergeRequest[]>(`/projects/${projectId(repo)}/merge_requests`, { state: "opened", per_page: 100 }),
    ]);
    // Merge requests from forks name branches of the fork, which may share a name with this project's.
    const withChange = new Set(open.filter((mr) => mr.source_project_id === undefined || mr.source_project_id === project.id).map((mr) => mr.source_branch));
    return {
      defaultBranch: project.default_branch ?? null,
      branches: branches.map((b) => ({
        name: b.name,
        sha: b.commit.id,
        committedAt: b.commit.committed_date ?? null,
        author: b.commit.author_name ?? null,
        openPulls: withChange.has(b.name) ? 1 : 0,
      })),
    };
  }

  /**
   * Commits per author and week on the default branch over the last year, from
   * the commit list (GitLab has no contributor statistics); at most 3000 commits.
   */
  async contributorWeeks(repo: RepoRef): Promise<ContributorWeeks[]> {
    const project = await this.project(repo);
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
    type Commit = { author_name: string; authored_date?: string; created_at: string; stats?: { additions: number; deletions: number } };
    const commits = await this.http.paginate<Commit>(`/projects/${project.id}/repository/commits`, { ref_name: project.default_branch ?? undefined, since, with_stats: true }, 3000);
    const people = new Map<string, Map<number, { c: number; a: number; d: number }>>();
    for (const c of commits) {
      const weeks = people.get(c.author_name) ?? new Map<number, { c: number; a: number; d: number }>();
      const w = weekStart(c.authored_date ?? c.created_at);
      const cell = weeks.get(w) ?? { c: 0, a: 0, d: 0 };
      cell.c += 1;
      cell.a += c.stats?.additions ?? 0;
      cell.d += c.stats?.deletions ?? 0;
      weeks.set(w, cell);
      people.set(c.author_name, weeks);
    }
    return [...people.entries()].map(([login, weeks]) => ({
      login,
      avatarUrl: null,
      weeks: [...weeks.entries()].sort(([a], [b]) => a - b).map(([w, v]) => ({ w, ...v })),
    }));
  }
}

