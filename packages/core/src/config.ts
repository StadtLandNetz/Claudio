import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RepoConfigSchema, type RepoConfig, type RoleConfig } from "./schemas.js";

export const DEFAULT_CONFIG_FILE = "claudio.config.json";

export function loadRepoConfig(path?: string): RepoConfig | null {
  const file = resolve(path ?? DEFAULT_CONFIG_FILE);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return RepoConfigSchema.parse(raw);
}

export type Credentials = { username: string; password: string };

/** Resolves a role's credentials from the process environment. Returns null when either variable is missing. */
export function resolveCredentials(role: RoleConfig, env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const username = env[role.usernameEnv];
  const password = env[role.passwordEnv];
  if (!username || !password) return null;
  return { username, password };
}
