import type { RoleConfig } from "./schemas.js";

export type Credentials = { username: string; password: string };

/** Resolves a role's credentials from the process environment. Returns null when either variable is missing. */
export function resolveCredentials(role: RoleConfig, env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const username = env[role.usernameEnv];
  const password = env[role.passwordEnv];
  if (!username || !password) return null;
  return { username, password };
}
