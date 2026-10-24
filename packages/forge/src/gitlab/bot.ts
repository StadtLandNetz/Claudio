import type { AccessLevel, RepoRef } from "../types.js";
import { GitlabForge } from "./forge.js";

/**
 * Claudio's own identity on GitLab: the personal access token (scope "api") of
 * a dedicated user, invited as Developer to the projects Claudio reviews. On
 * gitlab.com Free this is the way to a bot; service accounts need Premium.
 * Without GITLAB_BOT_TOKEN everything runs on the person's token.
 */
const botToken = (): string | null => process.env.GITLAB_BOT_TOKEN?.trim() || null;

const projects = new Map<string, { ok: boolean; at: number }>();
const FOUND_MS = 10 * 60_000;
const MISSING_MS = 60_000;

/** Developer access is what comments, commit statuses and issues need. */
const canWrite = (level: AccessLevel) => level === "write" || level === "admin";

/** The bot on a project, or null when there is no bot token or the bot has too little access there. */
export async function gitlabBotForge(repo: RepoRef): Promise<GitlabForge | null> {
  const token = botToken();
  if (!token) return null;
  const key = repo.externalId ? String(repo.externalId) : repo.fullName.toLowerCase();
  const hit = projects.get(key);
  if (hit && Date.now() - hit.at < (hit.ok ? FOUND_MS : MISSING_MS)) return hit.ok ? new GitlabForge(token, "bot") : null;
  const forge = new GitlabForge(token, "bot");
  const ok = canWrite(await forge.getAccessLevel(repo).catch(() => "none" as const));
  projects.set(key, { ok, at: Date.now() });
  return ok ? forge : null;
}

let username: { name: string | null; at: number } | undefined;

/** The bot's username, so its own comments do not trigger reviews. */
export async function gitlabBotUsername(): Promise<string | null> {
  const token = botToken();
  if (!token) return null;
  if (username && Date.now() - username.at < FOUND_MS) return username.name;
  const name = await new GitlabForge(token, "bot")
    .currentUser()
    .then((u) => u.login)
    .catch(() => null);
  username = { name, at: Date.now() };
  return name;
}

export type GitlabBotStatus = { configured: false } | { configured: true; username: string | null; level: AccessLevel; ok: boolean; expiresAt: string | null };

/** For the settings page: who the bot is, its access on the project, and when its token expires. */
export async function gitlabBotStatus(repo: RepoRef): Promise<GitlabBotStatus> {
  const token = botToken();
  if (!token) return { configured: false };
  const forge = new GitlabForge(token, "bot");
  const [user, level, pat] = await Promise.all([
    forge.currentUser().catch(() => null),
    forge.getAccessLevel(repo).catch(() => "none" as const),
    forge.http.get<{ expires_at?: string | null }>("/personal_access_tokens/self").catch(() => null),
  ]);
  return { configured: true, username: user?.login ?? null, level, ok: canWrite(level), expiresAt: pat?.expires_at ?? null };
}

/** Forgets cached project checks, e.g. after the bot was invited. */
export function forgetGitlabBot(): void {
  projects.clear();
  username = undefined;
}
