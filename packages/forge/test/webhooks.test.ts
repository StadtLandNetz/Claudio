import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideTrigger, renderInstanceUrl, verifyWebhookSignature, type AutomationSettings } from "../src/github/webhooks.js";

const all: AutomationSettings = { instanceUrlTemplate: "https://pr-{pr}.example.test", onComment: true, onLabel: true, onPush: true, analyzeOnMerge: true, commitStatus: true };
const pr = (extra: Record<string, unknown> = {}) => ({ number: 17, state: "open", draft: false, title: "Neue Fahrt", head: { sha: "abc", ref: "feature/16-Neue Fahrt" }, ...extra });

describe("signature", () => {
  const body = JSON.stringify({ zen: "Keep it logically awesome." });
  const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  it("accepts the right secret and rejects everything else", () => {
    expect(verifyWebhookSignature("s3cret", body, sig)).toBe(true);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body + " ", sig)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, null)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, "sha1=abc")).toBe(false);
  });
});

describe("instance URL template", () => {
  it("fills number, branch slug and sha", () => {
    expect(renderInstanceUrl("https://pr-{pr}.example.test", { number: 17, branch: "x", sha: "s" })).toBe("https://pr-17.example.test");
    expect(renderInstanceUrl("https://{branch_slug}.preview.test/?c={sha}", { number: 1, branch: "feature/16-Neue Fahrt", sha: "abc" })).toBe("https://feature-16-neue-fahrt.preview.test/?c=abc");
  });
});

describe("decideTrigger", () => {
  it("reviews on the /claudio review comment, with an optional budget", () => {
    const d = decideTrigger("issue_comment", { action: "created", issue: { number: 17, title: "T", pull_request: {} }, comment: { id: 9, body: "Bitte prüfen\n/claudio review thorough", user: { type: "User" } } }, all, "main");
    expect(d).toMatchObject({ kind: "review", prNumber: 17, trigger: "comment", budget: "thorough", commentId: 9 });
  });
  it("ignores comments on issues, by bots, or without the command", () => {
    expect(decideTrigger("issue_comment", { action: "created", issue: { number: 1 }, comment: { body: "/claudio review" } }, all, "main").kind).toBe("ignore");
    expect(decideTrigger("issue_comment", { action: "created", issue: { number: 1, pull_request: {} }, comment: { body: "/claudio review", user: { type: "Bot" } } }, all, "main").kind).toBe("ignore");
    expect(decideTrigger("issue_comment", { action: "created", issue: { number: 1, pull_request: {} }, comment: { body: "lgtm" } }, all, "main").kind).toBe("ignore");
  });
  it("reviews on the claudio-review label only", () => {
    expect(decideTrigger("pull_request", { action: "labeled", label: { name: "claudio-review" }, pull_request: pr() }, all, "main")).toMatchObject({ kind: "review", trigger: "label", headSha: "abc" });
    expect(decideTrigger("pull_request", { action: "labeled", label: { name: "bug" }, pull_request: pr() }, all, "main").kind).toBe("ignore");
  });
  it("reviews pushes when automatic reviews are on, but not drafts", () => {
    expect(decideTrigger("pull_request", { action: "synchronize", pull_request: pr() }, all, "main")).toMatchObject({ kind: "review", trigger: "push" });
    expect(decideTrigger("pull_request", { action: "synchronize", pull_request: pr({ draft: true }) }, all, "main").kind).toBe("ignore");
    expect(decideTrigger("pull_request", { action: "opened", pull_request: pr() }, { ...all, onPush: false }, "main").kind).toBe("ignore");
  });
  it("updates the knowledge base on pushes to the default branch only", () => {
    expect(decideTrigger("push", { ref: "refs/heads/main", after: "f00" }, all, "main")).toEqual({ kind: "analysis", branch: "main", headSha: "f00" });
    expect(decideTrigger("push", { ref: "refs/heads/feature", after: "f00" }, all, "main").kind).toBe("ignore");
    expect(decideTrigger("push", { ref: "refs/heads/main", after: "f00" }, { ...all, analyzeOnMerge: false }, "main").kind).toBe("ignore");
  });

  describe("deployments", () => {
    const env: AutomationSettings = { ...all, deploymentEnvironment: "Preview" };
    const status = (state: string, environment = "Preview", url = "https://devden.feature.nova.test") => ({
      deployment: { sha: "abc", environment },
      deployment_status: { state, environment, environment_url: url },
    });
    it("waits for the deployment instead of reviewing on push", () => {
      expect(decideTrigger("pull_request", { action: "synchronize", pull_request: pr() }, env, "main")).toMatchObject({ kind: "ignore", reason: "waiting for the Preview deployment" });
    });
    it("reviews once the configured environment deployed successfully", () => {
      expect(decideTrigger("deployment_status", status("success"), env, "main")).toEqual({ kind: "deployment", sha: "abc", environment: "Preview", url: "https://devden.feature.nova.test" });
    });
    it("ignores other environments, unfinished deployments and repos without an environment", () => {
      expect(decideTrigger("deployment_status", status("success", "production"), env, "main").kind).toBe("ignore");
      expect(decideTrigger("deployment_status", status("in_progress"), env, "main").kind).toBe("ignore");
      expect(decideTrigger("deployment_status", status("success", "Preview", ""), env, "main").kind).toBe("ignore");
      expect(decideTrigger("deployment_status", status("success"), all, "main").kind).toBe("ignore");
      expect(decideTrigger("deployment_status", status("success"), { ...env, onPush: false }, "main").kind).toBe("ignore");
    });
  });
});
