import { describe, expect, it } from "vitest";
import { ForgeAuthError } from "../src/types.js";
import { GitlabForge } from "../src/gitlab/forge.js";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Route = (url: URL, body: any) => Reply;

/** Just enough of GitLab's API: routes by "METHOD /path" (without /api/v4 and query); records every call. */
function fakeGitlab(routes: Record<string, Route | Reply>) {
  const calls: { method: string; path: string; query: URLSearchParams; body: any }[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v4/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, query: url.searchParams, body });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ message: "404 Not Found" }), { status: 404 });
    const reply = typeof route === "function" ? route(url, body) : route;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status, headers: reply.headers });
  }) as typeof fetch;
  const forge = new GitlabForge("glpat-secret", "user", { fetch: fetcher, baseUrl: "https://gitlab.example.test" });
  return { forge, calls };
}

const repo = { fullName: "slw/apps/dispo", externalId: 42 };
const me = { id: 7, username: "claudio-bot" };

describe("GitLab client", () => {
  it("pages through lists and addresses projects by id or encoded path", async () => {
    const { forge, calls } = fakeGitlab({
      "GET /projects": (url) =>
        url.searchParams.get("page") === "1"
          ? { body: [{ id: 1, path_with_namespace: "a/b", visibility: "private", default_branch: "main" }], headers: { "x-next-page": "2" } }
          : { body: [{ id: 2, path_with_namespace: "a/c/d", visibility: "public", default_branch: "dev" }] },
      "GET /projects/slw%2Fapps%2Fdispo/repository/branches/feature%2Fx": { body: { commit: { id: "sha1" } } },
    });
    const repos = await forge.listUserRepos();
    expect(repos.map((r) => [r.fullName, r.isPrivate, r.externalId])).toEqual([
      ["a/b", true, 1],
      ["a/c/d", false, 2],
    ]);
    expect(await forge.getBranchHead({ fullName: "slw/apps/dispo" }, "feature/x")).toBe("sha1");
    expect(calls[0]!.query.get("min_access_level")).toBe("20");
  });

  it("turns a rejected token into an auth error and hides 404s as no access", async () => {
    const { forge } = fakeGitlab({ "GET /projects/42": { status: 401, body: { message: "401 Unauthorized" } } });
    await expect(forge.getAccessLevel(repo)).rejects.toBeInstanceOf(ForgeAuthError);
    const { forge: other } = fakeGitlab({});
    expect(await other.getAccessLevel(repo)).toBe("none");
  });

  it("reads the role including inherited group membership", async () => {
    const { forge } = fakeGitlab({
      "GET /projects/42": { body: { id: 42, visibility: "private", permissions: { project_access: null, group_access: null } } },
      "GET /user": { body: me },
      "GET /projects/42/members/all/7": { body: { access_level: 40 } },
    });
    expect(await forge.getAccessLevel(repo)).toBe("admin");
  });

  it("builds the merge request context with diff counts and linked issues", async () => {
    const { forge } = fakeGitlab({
      "GET /projects/42/merge_requests/17": {
        body: { iid: 17, title: "Neue Fahrt", description: "Closes #16, see #3", state: "opened", source_branch: "16-neue-fahrt", target_branch: "main", sha: "abc", web_url: "https://gitlab.example.test/slw/apps/dispo/-/merge_requests/17", author: { username: "dev" }, draft: false, updated_at: "t" },
      },
      "GET /projects/42/merge_requests/17/diffs": {
        body: [
          { old_path: "a.ts", new_path: "a.ts", diff: "@@ -1 +1,2 @@\n-x\n+y\n+z\n" },
          { old_path: "old.ts", new_path: "new.ts", renamed_file: true, diff: "" },
          { old_path: "big.ts", new_path: "big.ts", new_file: true, too_large: true, diff: "" },
        ],
      },
      "GET /projects/42/merge_requests/17/closes_issues": { body: [{ iid: 16, title: "Fahrt anlegen", description: "AC", web_url: "u16", labels: ["feature"], state: "opened" }] },
      "GET /projects/42/issues/3": { body: { iid: 3, title: "Alt", description: null, web_url: "u3", state: "closed" } },
    });
    const ctx = await forge.fetchChangeContext(repo, 17);
    expect(ctx).toMatchObject({ provider: "gitlab", owner: "slw/apps", repo: "dispo", number: 17, headRef: "16-neue-fahrt", headSha: "abc", baseRef: "main", author: "dev" });
    expect(ctx.files).toEqual([
      { filename: "a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-x\n+y\n+z\n", previousFilename: undefined },
      { filename: "new.ts", status: "renamed", additions: 0, deletions: 0, patch: undefined, previousFilename: "old.ts" },
      { filename: "big.ts", status: "added", additions: 0, deletions: 0, patch: undefined, previousFilename: undefined },
    ]);
    expect(ctx.issues.map((i) => [i.number, i.state, i.labels])).toEqual([
      [16, "open", ["feature"]],
      [3, "closed", []],
    ]);
  });

  it("clones with the token as oauth2 user and keeps it out of the remote", async () => {
    const { forge } = fakeGitlab({});
    const spec = await forge.cloneSpec(repo);
    expect(spec.url).toBe("https://oauth2:glpat-secret@gitlab.example.test/slw/apps/dispo.git");
    expect(spec.publicUrl).toBe("https://gitlab.example.test/slw/apps/dispo.git");
    expect(forge.redact(`fatal: ${spec.url}`)).not.toContain("glpat-secret");
  });
});

describe("GitLab reviews", () => {
  const base = {
    "GET /user": { body: me },
    "POST /projects/42/merge_requests/17/draft_notes": { body: { id: 5 } },
    "GET /projects/42/merge_requests/17/notes": { body: [{ id: 300, body: "Claudio Review", author: { id: 7 } }] },
    "POST /projects/42/merge_requests/17/notes": { body: { id: 301 } },
  };

  it("requests changes as a review when something blocks", async () => {
    const { forge, calls } = fakeGitlab({ ...base, "GET /projects/42/merge_requests/17/reviewers": { body: [] }, "POST /projects/42/merge_requests/17/draft_notes/bulk_publish": { status: 204 } });
    const posted = await forge.postReview(repo, 17, "**Claudio Review: changes needed**", true);
    expect(posted).toEqual({ url: "https://gitlab.example.test/slw/apps/dispo/-/merge_requests/17#note_300", requestedChanges: true });
    expect(calls.find((c) => c.path.endsWith("/bulk_publish"))!.body).toEqual({ reviewer_state: "requested_changes" });
  });

  it("withdraws its earlier change request with a later approving review", async () => {
    const { forge, calls } = fakeGitlab({
      ...base,
      "GET /projects/42/merge_requests/17/reviewers": { body: [{ user: { id: 7 }, state: "requested_changes" }] },
      "POST /projects/42/merge_requests/17/draft_notes/bulk_publish": { status: 204 },
    });
    expect(await forge.postReview(repo, 17, "ok", false)).toMatchObject({ requestedChanges: false });
    expect(calls.find((c) => c.path.endsWith("/bulk_publish"))!.body).toEqual({ reviewer_state: "reviewed" });
  });

  it("posts a plain comment when nothing blocks, and when GitLab refuses the review", async () => {
    const plain = fakeGitlab({ ...base, "GET /projects/42/merge_requests/17/reviewers": { body: [] } });
    expect(await plain.forge.postReview(repo, 17, "ok", false)).toEqual({ url: "https://gitlab.example.test/slw/apps/dispo/-/merge_requests/17#note_301", requestedChanges: false });
    expect(plain.calls.some((c) => c.path.includes("draft_notes"))).toBe(false);

    const refused = fakeGitlab({
      ...base,
      "GET /projects/42/merge_requests/17/reviewers": { body: [] },
      "POST /projects/42/merge_requests/17/draft_notes/bulk_publish": { status: 500, body: { message: "500 Internal Server Error" } },
      "DELETE /projects/42/merge_requests/17/draft_notes/5": { status: 204 },
    });
    expect(await refused.forge.postReview(repo, 17, "blocking", true)).toMatchObject({ requestedChanges: false });
    expect(refused.calls.some((c) => c.method === "DELETE" && c.path.endsWith("/draft_notes/5"))).toBe(true);
  });
});

describe("GitLab commit status and deployments", () => {
  it("maps states and accepts a status that is already set", async () => {
    const { forge, calls } = fakeGitlab({
      "POST /projects/42/statuses/abc": (_url, body) => (body.state === "pending" ? { status: 400, body: { message: "Cannot transition status via :enqueue from :pending" } } : { body: {} }),
    });
    await forge.setCommitStatus(repo, "abc", "pending", "läuft", { ref: "16-neue-fahrt", targetUrl: "https://claudio.test/reviews/1" });
    await forge.setCommitStatus(repo, "abc", "error", "kaputt");
    expect(calls.map((c) => c.body.state)).toEqual(["pending", "failed"]);
    expect(calls[0]!.body).toMatchObject({ name: "Claudio", ref: "16-neue-fahrt", target_url: "https://claudio.test/reviews/1" });
  });

  it("finds the review app of the head commit, or of an earlier commit", async () => {
    const deployments = [
      { sha: "old", status: "success", created_at: "t1", environment: { name: "review/16-neue-fahrt", external_url: "https://old.example.test" } },
      { sha: "prod", status: "success", created_at: "t0", environment: { name: "production", tier: "production", external_url: "https://app.example.test" } },
    ];
    const { forge } = fakeGitlab({
      "GET /projects/42/deployments": { body: deployments },
      "GET /projects/42/merge_requests/17/commits": { body: [{ id: "head" }, { id: "old" }] },
    });
    expect(await forge.findPreviewDeployment(repo, { sha: "old", environment: "review" })).toMatchObject({ url: "https://old.example.test", exact: true, environment: "review/16-neue-fahrt" });
    expect(await forge.findPreviewDeployment(repo, { sha: "head", number: 17, environment: "review" })).toMatchObject({ url: "https://old.example.test", exact: false });
    expect(await forge.findPreviewDeployment(repo, { sha: "prod" })).toBeNull();
  });
});
