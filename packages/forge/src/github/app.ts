import { App, Octokit } from "octokit";
import { parseRepo } from "./links.js";

/**
 * Claudio as a GitHub App: comments, reviews, commit statuses and issues come
 * from "Claudio[bot]" and run on the app's installation token, not on the token
 * of whoever set up the repository. Configured with GITHUB_APP_ID and
 * GITHUB_APP_PRIVATE_KEY (PEM; "\n" escapes are accepted); without them
 * everything falls back to the person's token as before.
 */
let app: App | null | undefined;

export function githubApp(): App | null {
  if (app !== undefined) return app;
  const appId = process.env.GITHUB_APP_ID?.trim();
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  app = appId && key ? new App({ appId, privateKey: key, Octokit }) : null;
  return app;
}

/** Public name of the app, for its install link (https://github.com/apps/<slug>). */
export const githubAppSlug = (): string | null => process.env.GITHUB_APP_SLUG?.trim() || null;

/** Secret of the app's own webhook (events of every repository it is installed on). */
export const githubAppWebhookSecret = (): string | null => process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() || null;

const installations = new Map<string, { id: number | null; at: number }>();
const FOUND_MS = 10 * 60_000;
const MISSING_MS = 60_000;

/** The app's installation that covers a repository, or null when it is not installed there. */
export async function installationFor(repoFullName: string): Promise<number | null> {
  const a = githubApp();
  if (!a) return null;
  const key = repoFullName.toLowerCase();
  const hit = installations.get(key);
  if (hit && Date.now() - hit.at < (hit.id ? FOUND_MS : MISSING_MS)) return hit.id;
  const { owner, repo } = parseRepo(repoFullName);
  let id: number | null = null;
  try {
    const { data } = await a.octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
    id = data.id;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  installations.set(key, { id, at: Date.now() });
  return id;
}

/** A client acting as the app on this repository, or null when the app is not set up or not installed. */
export async function botClient(repoFullName: string): Promise<Octokit | null> {
  const a = githubApp();
  if (!a) return null;
  const id = await installationFor(repoFullName).catch(() => null);
  return id ? ((await a.getInstallationOctokit(id)) as unknown as Octokit) : null;
}

/** A short-lived installation token (about an hour), e.g. to clone the repository. */
export async function botToken(repoFullName: string): Promise<string | null> {
  const client = await botClient(repoFullName);
  if (!client) return null;
  const auth = (await client.auth({ type: "installation" })) as { token?: string };
  return auth.token ?? null;
}

/** Forgets cached installations, e.g. after the app was installed. */
export function forgetInstallations(): void {
  installations.clear();
}
