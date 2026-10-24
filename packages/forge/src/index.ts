import type { AutomationSettings, Provider } from "@claudio/core";
import { botClient } from "./github/app.js";
import { GithubForge } from "./github/forge.js";
import { githubOAuth } from "./github/oauth.js";
import { decideTrigger as decideGithubTrigger, type TriggerDecision } from "./github/webhooks.js";
import { gitlabBotForge } from "./gitlab/bot.js";
import { gitlabBaseUrl } from "./gitlab/config.js";
import { GitlabForge } from "./gitlab/forge.js";
import { gitlabOAuth } from "./gitlab/oauth.js";
import { decideGitlabTrigger } from "./gitlab/webhooks.js";
import type { Forge, OAuthProvider, RepoRef } from "./types.js";

export * from "./types.js";
export { GithubForge, githubLevel } from "./github/forge.js";
export { githubApp, githubAppSlug, githubAppWebhookSecret, installationFor, forgetInstallations } from "./github/app.js";
export { WEBHOOK_EVENTS } from "./github/client.js";
export { extractLinkedIssueNumbers, parseRepo } from "./github/links.js";
export { verifyWebhookSignature, type TriggerDecision } from "./github/webhooks.js";
export { REVIEW_LABEL } from "./shared/commands.js";
export { GitlabForge, GITLAB_HOOK_EVENTS } from "./gitlab/forge.js";
export { gitlabBotStatus, gitlabBotUsername, forgetGitlabBot, type GitlabBotStatus } from "./gitlab/bot.js";
export { verifyGitlabToken } from "./gitlab/webhooks.js";
export { renderInstanceUrl, type AutomationSettings } from "@claudio/core";
export { gitlabBaseUrl, gitlabHost } from "./gitlab/config.js";

/** The repository's page on GitHub or GitLab. */
export function repoWebUrl(repo: { provider: Provider; fullName: string }): string {
  return repo.provider === "gitlab" ? `${gitlabBaseUrl()}/${repo.fullName}` : `https://github.com/${repo.fullName}`;
}

/** A client for the provider, acting with a person's token. */
export function forgeFor(provider: Provider, token: string): Forge {
  return provider === "gitlab" ? new GitlabForge(token) : GithubForge.withToken(token);
}

type RepoOf = RepoRef & { provider: Provider };

/**
 * Claudio's own identity on the repository, or null when there is none: the
 * GitHub App where it is installed, the GitLab bot user where it is a developer.
 * Comments, statuses and issues then come from Claudio instead of a person.
 */
export async function botForge(repo: RepoOf): Promise<Forge | null> {
  if (repo.provider === "github") {
    const client = await botClient(repo.fullName).catch(() => null);
    if (!client) return null;
    return new GithubForge(client, "bot", async () => {
      const auth = (await client.auth({ type: "installation" })) as { token?: string };
      if (!auth.token) throw new Error("GitHub App returned no installation token");
      return auth.token;
    });
  }
  return gitlabBotForge(repo);
}

export function oauth(provider: Provider): OAuthProvider {
  return provider === "gitlab" ? gitlabOAuth : githubOAuth;
}

/**
 * What a webhook event means for Claudio. Pure: the caller verifies the delivery,
 * loads the repository's settings and creates the job.
 */
export function decideTrigger(
  provider: Provider,
  event: string,
  payload: Record<string, any>,
  settings: AutomationSettings,
  defaultBranch: string | null,
  opts: { botUsernames?: string[] } = {},
): TriggerDecision {
  return provider === "gitlab" ? decideGitlabTrigger(event, payload, settings, defaultBranch, opts) : decideGithubTrigger(event, payload, settings, defaultBranch);
}
