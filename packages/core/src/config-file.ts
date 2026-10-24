import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { RepoConfigSchema, type RepoConfig } from "./schemas.js";

/**
 * Reading claudio.config.json needs the file system, so it lives outside the
 * package index: the web app's browser code imports the index too.
 */
export const DEFAULT_CONFIG_FILE = "claudio.config.json";

export function loadRepoConfig(path?: string): RepoConfig | null {
  const file = resolve(path ?? DEFAULT_CONFIG_FILE);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return RepoConfigSchema.parse(raw);
}
