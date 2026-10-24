// Repository paths, also used by the web app's route matcher, which Node loads on its own
// during the build: this module must not import anything.

type Provider = "github" | "gitlab";

const SEGMENT = /^[\w.-]+$/;

/** Whether a full name fits the provider: exactly two segments on GitHub, two or more on GitLab. */
export function isValidFullName(provider: Provider, fullName: string): boolean {
  const parts = fullName.split("/");
  if (!parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..")) return false;
  return provider === "github" ? parts.length === 2 : parts.length >= 2;
}

type RepoKey = { provider?: Provider | null; fullName: string };

/**
 * The repository's path below /repos: owner/name for GitHub (as before, so old
 * links keep working) and gitlab/<group>/…/<project> for GitLab. GitLab paths
 * always have three or more segments, so the two never collide, not even with a
 * GitHub owner called "gitlab".
 */
export function repoPath(repo: RepoKey): string {
  return (repo.provider ?? "github") === "gitlab" ? `gitlab/${repo.fullName}` : repo.fullName;
}

export function repoHref(repo: RepoKey, query?: string): string {
  return `/repos/${repoPath(repo)}${query ? `?${query.replace(/^\?/, "")}` : ""}`;
}

/** The inverse of repoPath; null when the path names no repository. */
export function parseRepoPath(path: string): { provider: Provider; fullName: string } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 2) {
    const fullName = parts.join("/");
    return isValidFullName("github", fullName) ? { provider: "github", fullName } : null;
  }
  if (parts.length >= 3 && parts[0] === "gitlab") {
    const fullName = parts.slice(1).join("/");
    return isValidFullName("gitlab", fullName) ? { provider: "gitlab", fullName } : null;
  }
  return null;
}

/**
 * A repository typed into the "add" form: owner/name, group/…/project or a link
 * to it on the provider's host (https://github.com/o/r, https://gitlab.com/g/p/-/tree/main).
 * Null when it names no repository of that provider.
 */
export function parseRepoInput(input: string, provider: Provider, host: string = provider === "gitlab" ? "gitlab.com" : "github.com"): string | null {
  let path = input.trim();
  const url = /^https?:\/\//i.test(path) ? URL.parse(path) : null;
  if (url) {
    if (url.host.toLowerCase() !== host.toLowerCase()) return null;
    path = url.pathname;
  }
  path = path
    .replace(/\/-\/.*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return isValidFullName(provider, path) ? path : null;
}

/** Namespace (owner, or the group path on GitLab) and the repository's own name. */
export function splitRepo(fullName: string): { namespace: string; name: string } {
  const i = fullName.lastIndexOf("/");
  return i < 0 ? { namespace: "", name: fullName } : { namespace: fullName.slice(0, i), name: fullName.slice(i + 1) };
}
