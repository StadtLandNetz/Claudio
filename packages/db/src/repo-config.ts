import { RepoConfigSchema, type RepoConfig } from "@claudio/core";
import { decrypt } from "./crypto.js";
import type { Repo, RepoRole } from "./schema.js";

/** Env var names under which a role's decrypted credentials are handed to the Claudio tools. */
export function roleEnvNames(roleName: string): { usernameEnv: string; passwordEnv: string } {
  const key = roleName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return { usernameEnv: `CLAUDIO_ROLE_${key}_USER`, passwordEnv: `CLAUDIO_ROLE_${key}_PASSWORD` };
}

/**
 * Builds the runner's RepoConfig from the stored repo and roles, plus the env
 * map that carries the decrypted credentials. The env map goes only to the
 * Claudio tools (login_as), never to the agent process.
 */
export function toRepoConfig(
  repo: Pick<Repo, "fullName" | "notes" | "extraAllowedHosts">,
  roles: RepoRole[],
  decryptFn: (value: string) => string = decrypt,
): { config: RepoConfig; roleEnv: Record<string, string> } {
  const roleEnv: Record<string, string> = {};
  const configRoles: Record<string, unknown> = {};
  for (const role of roles) {
    const names = roleEnvNames(role.name);
    roleEnv[names.usernameEnv] = decryptFn(role.usernameEnc);
    roleEnv[names.passwordEnv] = decryptFn(role.passwordEnc);
    configRoles[role.name] = {
      description: role.description ?? undefined,
      ...names,
      loginPath: role.loginPath,
      successUrlContains: role.successUrlContains ?? undefined,
      recipe: role.recipe ?? undefined,
    };
  }
  const config = RepoConfigSchema.parse({
    repo: repo.fullName,
    notes: repo.notes ?? undefined,
    extraAllowedHosts: repo.extraAllowedHosts ?? [],
    roles: configRoles,
  });
  return { config, roleEnv };
}
