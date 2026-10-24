import { timingSafeEqual } from "node:crypto";
import { envMatches, type AutomationSettings } from "@claudio/core";
import { REVIEW_LABEL, reviewCommand } from "../shared/commands.js";
import type { TriggerDecision } from "../github/webhooks.js";

type Payload = Record<string, any>;

/** GitLab sends the webhook's secret token back as-is in X-Gitlab-Token. */
export function verifyGitlabToken(secret: string, header: string | null | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(secret);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const labelTitles = (labels: unknown): string[] => (Array.isArray(labels) ? labels.map((l) => String(l?.title ?? l?.name ?? "")) : []);

/**
 * Decides what a GitLab event means for Claudio. Pure: the caller verifies the
 * token, loads the repository's settings and creates the job. GitLab's user
 * objects carry no bot flag, so Claudio's own comments are recognised by the bot's username.
 */
export function decideGitlabTrigger(
  event: string,
  payload: Payload,
  settings: AutomationSettings,
  defaultBranch: string | null,
  opts: { botUsernames?: string[] } = {},
): TriggerDecision {
  const kind = String(payload.object_kind ?? event);

  if (kind === "merge_request") {
    const mr = payload.object_attributes;
    if (!mr) return { kind: "ignore", reason: "no merge request in payload" };
    if (mr.state !== "opened") return { kind: "ignore", reason: "merge request is not open" };
    const base = { prNumber: Number(mr.iid), headSha: mr.last_commit?.id ?? null, branch: mr.source_branch ?? null, title: mr.title ?? null };
    const changes = payload.changes ?? {};

    if (changes.labels) {
      const added = labelTitles(changes.labels.current).includes(REVIEW_LABEL) && !labelTitles(changes.labels.previous).includes(REVIEW_LABEL);
      if (added) {
        if (!settings.onLabel) return { kind: "ignore", reason: "label trigger is off" };
        return { kind: "review", ...base, trigger: "label" };
      }
    }

    // New commits (an update with the previous head), opened, reopened, or taken out of draft.
    const pushed = mr.action === "update" && Boolean(mr.oldrev);
    const readied = changes.draft?.previous === true && changes.draft?.current === false;
    if (mr.action === "open" || mr.action === "reopen" || pushed || readied) {
      if (!settings.onPush) return { kind: "ignore", reason: "automatic reviews are off" };
      if (mr.draft ?? mr.work_in_progress) return { kind: "ignore", reason: "draft merge request" };
      if (settings.deploymentEnvironment) return { kind: "ignore", reason: `waiting for the ${settings.deploymentEnvironment} deployment` };
      return { kind: "review", ...base, trigger: "push" };
    }
    if (changes.labels) return { kind: "ignore", reason: `label is not ${REVIEW_LABEL}` };
    return { kind: "ignore", reason: `merge_request.${mr.action ?? "?"} is not a trigger` };
  }

  if (kind === "note") {
    const note = payload.object_attributes;
    if (note?.noteable_type !== "MergeRequest") return { kind: "ignore", reason: "comment is not on a merge request" };
    // Newer GitLab versions also send edits; only new comments count.
    if (note.action && note.action !== "create") return { kind: "ignore", reason: "comment not created" };
    if (!settings.onComment) return { kind: "ignore", reason: "comment trigger is off" };
    if (note.system) return { kind: "ignore", reason: "system note" };
    if (payload.user?.username && opts.botUsernames?.includes(payload.user.username)) return { kind: "ignore", reason: "comment by Claudio" };
    const command = reviewCommand(String(note.note ?? ""));
    if (!command) return { kind: "ignore", reason: "no /claudio review command" };
    const mr = payload.merge_request ?? {};
    if (mr.state && mr.state !== "opened") return { kind: "ignore", reason: "merge request is not open" };
    return {
      kind: "review",
      prNumber: Number(mr.iid),
      headSha: mr.last_commit?.id ?? null,
      branch: mr.source_branch ?? null,
      title: mr.title ?? null,
      trigger: "comment",
      budget: command.budget,
      commentId: note.id,
    };
  }

  if (kind === "deployment") {
    const env = settings.deploymentEnvironment;
    if (!env) return { kind: "ignore", reason: "no deployment environment configured" };
    if (!settings.onPush) return { kind: "ignore", reason: "automatic reviews are off" };
    const environment = String(payload.environment ?? "");
    if (!envMatches(env, environment)) return { kind: "ignore", reason: `deployment to ${environment || "?"}, not ${env}` };
    if (payload.status !== "success") return { kind: "ignore", reason: `deployment ${payload.status ?? "?"}` };
    const url = String(payload.environment_external_url ?? "");
    if (!url) return { kind: "ignore", reason: "deployment without environment URL" };
    // The payload has only the short sha; the commit link carries the full one.
    const sha = String(payload.commit_url ?? "").match(/\/commit\/([0-9a-f]{40})\b/)?.[1] ?? String(payload.sha ?? "");
    if (!sha) return { kind: "ignore", reason: "deployment without commit" };
    return { kind: "deployment", sha, environment, url };
  }

  if (kind === "push") {
    const branch = String(payload.ref ?? "").replace(/^refs\/heads\//, "");
    if (!settings.analyzeOnMerge) return { kind: "ignore", reason: "knowledge update on merge is off" };
    if (!defaultBranch || branch !== defaultBranch) return { kind: "ignore", reason: `push to ${branch || "?"}, not the default branch` };
    if (/^0+$/.test(String(payload.after ?? ""))) return { kind: "ignore", reason: "branch deleted" };
    return { kind: "analysis", branch, headSha: String(payload.checkout_sha ?? payload.after) };
  }

  return { kind: "ignore", reason: `event ${event} is not handled` };
}
