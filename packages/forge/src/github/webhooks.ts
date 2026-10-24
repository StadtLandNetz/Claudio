import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies GitHub's X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(secret: string, rawBody: string | Buffer, header: string | null | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Per-repository automation settings. */
export type AutomationSettings = {
  /** Instance URL of a PR, e.g. https://pr-{pr}.preview.example.de. Placeholders: {pr}, {branch}, {branch_slug}, {sha}. */
  instanceUrlTemplate: string;
  onComment: boolean;
  onLabel: boolean;
  /** Review every opened, reopened or updated (pushed) PR. */
  onPush: boolean;
  /** Update the knowledge base when the default branch receives a push. */
  analyzeOnMerge: boolean;
  /** Report the result as a commit status on the PR head. */
  commitStatus: boolean;
  /**
   * GitHub environment of the PR review instances (e.g. "Preview"). When set, the
   * instance URL comes from the PR's deployment in that environment, and automatic
   * reviews start once that deployment succeeds instead of on the push.
   */
  deploymentEnvironment?: string;
};

export const REVIEW_LABEL = "claudio-review";
const COMMAND = /^\s*\/claudio\s+review\b(.*)$/im;

/** Builds a PR's instance URL from the repo's template. */
export function renderInstanceUrl(template: string, pr: { number: number; branch: string; sha: string }): string {
  const slug = pr.branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return template
    .replace(/\{pr\}/g, String(pr.number))
    .replace(/\{branch_slug\}/g, slug)
    .replace(/\{branch\}/g, encodeURIComponent(pr.branch))
    .replace(/\{sha\}/g, pr.sha);
}

export type TriggerDecision =
  | { kind: "review"; prNumber: number; headSha: string | null; branch: string | null; title: string | null; trigger: "comment" | "label" | "push"; budget?: "quick" | "standard" | "thorough"; commentId?: number }
  | { kind: "analysis"; branch: string; headSha: string }
  | { kind: "deployment"; sha: string; environment: string; url: string }
  | { kind: "ignore"; reason: string };

type Payload = Record<string, any>;

/**
 * Decides what a GitHub event means for Claudio. Pure: the caller verifies the
 * signature, loads the repo's settings and creates the job.
 */
export function decideTrigger(event: string, payload: Payload, settings: AutomationSettings, defaultBranch: string | null): TriggerDecision {
  if (event === "ping") return { kind: "ignore", reason: "ping" };

  if (event === "pull_request") {
    const pr = payload.pull_request;
    if (!pr) return { kind: "ignore", reason: "no pull request in payload" };
    if (pr.state !== "open") return { kind: "ignore", reason: "pull request is not open" };
    const base = { prNumber: pr.number as number, headSha: pr.head?.sha ?? null, branch: pr.head?.ref ?? null, title: pr.title ?? null };
    if (payload.action === "labeled") {
      if (!settings.onLabel) return { kind: "ignore", reason: "label trigger is off" };
      if (payload.label?.name !== REVIEW_LABEL) return { kind: "ignore", reason: `label is not ${REVIEW_LABEL}` };
      return { kind: "review", ...base, trigger: "label" };
    }
    if (["opened", "reopened", "synchronize", "ready_for_review"].includes(payload.action)) {
      if (!settings.onPush) return { kind: "ignore", reason: "automatic reviews are off" };
      if (pr.draft) return { kind: "ignore", reason: "draft pull request" };
      if (settings.deploymentEnvironment) return { kind: "ignore", reason: `waiting for the ${settings.deploymentEnvironment} deployment` };
      return { kind: "review", ...base, trigger: "push" };
    }
    return { kind: "ignore", reason: `pull_request.${payload.action} is not a trigger` };
  }

  if (event === "issue_comment") {
    if (payload.action !== "created") return { kind: "ignore", reason: "comment not created" };
    if (!payload.issue?.pull_request) return { kind: "ignore", reason: "comment is not on a pull request" };
    if (!settings.onComment) return { kind: "ignore", reason: "comment trigger is off" };
    if (payload.comment?.user?.type === "Bot") return { kind: "ignore", reason: "comment by a bot" };
    const m = String(payload.comment?.body ?? "").match(COMMAND);
    if (!m) return { kind: "ignore", reason: "no /claudio review command" };
    const budget = m[1]!.match(/\b(quick|standard|thorough)\b/i)?.[1]?.toLowerCase() as "quick" | "standard" | "thorough" | undefined;
    return { kind: "review", prNumber: payload.issue.number, headSha: null, branch: null, title: payload.issue.title ?? null, trigger: "comment", budget, commentId: payload.comment?.id };
  }

  if (event === "deployment_status") {
    const env = settings.deploymentEnvironment;
    if (!env) return { kind: "ignore", reason: "no deployment environment configured" };
    if (!settings.onPush) return { kind: "ignore", reason: "automatic reviews are off" };
    const status = payload.deployment_status;
    const environment = String(payload.deployment?.environment ?? status?.environment ?? "");
    if (environment.toLowerCase() !== env.toLowerCase()) return { kind: "ignore", reason: `deployment to ${environment || "?"}, not ${env}` };
    if (status?.state !== "success") return { kind: "ignore", reason: `deployment ${status?.state ?? "?"}` };
    const url = status.environment_url || payload.deployment?.payload?.web_url || "";
    if (!url) return { kind: "ignore", reason: "deployment without environment URL" };
    return { kind: "deployment", sha: String(payload.deployment?.sha ?? ""), environment, url };
  }

  if (event === "push") {
    const branch = String(payload.ref ?? "").replace(/^refs\/heads\//, "");
    if (!settings.analyzeOnMerge) return { kind: "ignore", reason: "knowledge update on merge is off" };
    if (!defaultBranch || branch !== defaultBranch) return { kind: "ignore", reason: `push to ${branch || "?"}, not the default branch` };
    if (payload.deleted) return { kind: "ignore", reason: "branch deleted" };
    return { kind: "analysis", branch, headSha: payload.after };
  }

  return { kind: "ignore", reason: `event ${event} is not handled` };
}
