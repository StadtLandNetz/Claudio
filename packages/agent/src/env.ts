/** Anthropic credentials a model session could pick up from the environment. */
const ANTHROPIC_CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"];

/**
 * Environment for a model session. With a repository key, every other Anthropic
 * credential is removed so the run cannot fall back to the server's key or login.
 * Without one (CLI), the environment is used as it is.
 */
export function modelEnv(env: Record<string, string | undefined>, apiKey: string | undefined): Record<string, string | undefined> {
  if (!apiKey) return env;
  const out = envWithout(env as NodeJS.ProcessEnv, ANTHROPIC_CREDENTIALS);
  out.ANTHROPIC_API_KEY = apiKey;
  return out;
}

export function envWithout(env: NodeJS.ProcessEnv, keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const k of keys) delete out[k];
  return out;
}
