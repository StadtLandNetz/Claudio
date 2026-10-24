import { describe, expect, it } from "vitest";
import type { AutomationSettings } from "@claudio/core";
import { decideGitlabTrigger, verifyGitlabToken } from "../src/gitlab/webhooks.js";

const all: AutomationSettings = { instanceUrlTemplate: "https://mr-{pr}.example.test", onComment: true, onLabel: true, onPush: true, analyzeOnMerge: true, commitStatus: true };
const mr = (attrs: Record<string, unknown> = {}, changes: Record<string, unknown> = {}) => ({
  object_kind: "merge_request",
  object_attributes: { iid: 17, state: "opened", action: "open", title: "Neue Fahrt", source_branch: "16-neue-fahrt", last_commit: { id: "abc" }, draft: false, ...attrs },
  changes,
});
const note = (body: string, extra: Record<string, unknown> = {}) => ({
  object_kind: "note",
  user: { username: "lars" },
  object_attributes: { id: 99, note: body, noteable_type: "MergeRequest", action: "create", ...extra },
  merge_request: { iid: 17, state: "opened", title: "Neue Fahrt", source_branch: "16-neue-fahrt", last_commit: { id: "abc" } },
});

describe("GitLab webhook token", () => {
  it("accepts only the exact secret", () => {
    expect(verifyGitlabToken("s3cret", "s3cret")).toBe(true);
    expect(verifyGitlabToken("s3cret", "s3cre")).toBe(false);
    expect(verifyGitlabToken("s3cret", "other!")).toBe(false);
    expect(verifyGitlabToken("s3cret", null)).toBe(false);
  });
});

describe("GitLab merge request events", () => {
  it("reviews opened, reopened and pushed merge requests", () => {
    expect(decideGitlabTrigger("Merge Request Hook", mr(), all, "main")).toMatchObject({ kind: "review", prNumber: 17, headSha: "abc", branch: "16-neue-fahrt", trigger: "push" });
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "reopen" }), all, "main")).toMatchObject({ kind: "review" });
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update", oldrev: "old" }), all, "main")).toMatchObject({ kind: "review", trigger: "push" });
  });

  it("ignores updates without new commits, drafts, closed ones and switched-off reviews", () => {
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update" }), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Merge Request Hook", mr({ draft: true }), all, "main")).toMatchObject({ kind: "ignore", reason: "draft merge request" });
    expect(decideGitlabTrigger("Merge Request Hook", mr({ state: "merged", action: "merge" }), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Merge Request Hook", mr(), { ...all, onPush: false }, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Merge Request Hook", mr(), { ...all, deploymentEnvironment: "review" }, "main")).toMatchObject({ kind: "ignore", reason: "waiting for the review deployment" });
  });

  it("reviews a merge request taken out of draft", () => {
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update" }, { draft: { previous: true, current: false } }), all, "main")).toMatchObject({ kind: "review", trigger: "push" });
  });

  it("reviews when the label is added, not when it was there already", () => {
    const labels = (previous: string[], current: string[]) => ({ labels: { previous: previous.map((title) => ({ title })), current: current.map((title) => ({ title })) } });
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update" }, labels([], ["claudio-review"])), all, "main")).toMatchObject({ kind: "review", trigger: "label" });
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update" }, labels(["claudio-review"], ["claudio-review", "bug"])), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Merge Request Hook", mr({ action: "update" }, labels([], ["claudio-review"])), { ...all, onLabel: false }, "main").kind).toBe("ignore");
  });
});

describe("GitLab comments", () => {
  it("starts a review with the budget from /claudio review", () => {
    expect(decideGitlabTrigger("Note Hook", note("/claudio review thorough"), all, "main")).toEqual({
      kind: "review",
      prNumber: 17,
      headSha: "abc",
      branch: "16-neue-fahrt",
      title: "Neue Fahrt",
      trigger: "comment",
      budget: "thorough",
      commentId: 99,
    });
  });

  it("ignores other comments", () => {
    expect(decideGitlabTrigger("Note Hook", note("looks good"), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Note Hook", note("/claudio review", { noteable_type: "Issue" }), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Note Hook", note("/claudio review", { action: "update" }), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Note Hook", note("/claudio review", { system: true }), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Note Hook", note("/claudio review"), { ...all, onComment: false }, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Note Hook", { ...note("/claudio review"), user: { username: "claudio-bot" } }, all, "main", { botUsernames: ["claudio-bot"] })).toMatchObject({
      kind: "ignore",
      reason: "comment by Claudio",
    });
  });
});

describe("GitLab deployments and pushes", () => {
  const deployment = (extra: Record<string, unknown> = {}) => ({
    object_kind: "deployment",
    status: "success",
    environment: "review/16-neue-fahrt",
    environment_external_url: "https://16-neue-fahrt.review.example.test",
    short_sha: "279484c0",
    commit_url: "https://gitlab.com/slw/dispo/-/commit/279484c09fbe69ededfced8c1bb6e6d24616b468",
    ...extra,
  });
  const env = { ...all, deploymentEnvironment: "review" };

  it("takes the full commit from the link and matches the environment folder", () => {
    expect(decideGitlabTrigger("Deployment Hook", deployment(), env, "main")).toEqual({
      kind: "deployment",
      sha: "279484c09fbe69ededfced8c1bb6e6d24616b468",
      environment: "review/16-neue-fahrt",
      url: "https://16-neue-fahrt.review.example.test",
    });
  });

  it("ignores other environments, failed deployments and missing addresses", () => {
    expect(decideGitlabTrigger("Deployment Hook", deployment({ environment: "staging" }), env, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Deployment Hook", deployment({ environment: "reviewer" }), env, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Deployment Hook", deployment({ status: "failed" }), env, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Deployment Hook", deployment({ environment_external_url: null }), env, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Deployment Hook", deployment(), all, "main").kind).toBe("ignore");
  });

  it("updates the knowledge base on pushes to the default branch only", () => {
    const push = (ref: string, after = "def") => ({ object_kind: "push", ref, after, checkout_sha: after });
    expect(decideGitlabTrigger("Push Hook", push("refs/heads/main"), all, "main")).toEqual({ kind: "analysis", branch: "main", headSha: "def" });
    expect(decideGitlabTrigger("Push Hook", push("refs/heads/feature"), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Push Hook", push("refs/heads/main", "0000000000000000000000000000000000000000"), all, "main").kind).toBe("ignore");
    expect(decideGitlabTrigger("Push Hook", push("refs/heads/main"), { ...all, analyzeOnMerge: false }, "main").kind).toBe("ignore");
  });
});
