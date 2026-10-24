/** The GitLab instance (gitlab.com or self-managed), without a trailing slash. */
export const gitlabBaseUrl = (): string => (process.env.GITLAB_URL?.trim() || "https://gitlab.com").replace(/\/+$/, "");

/** Host of the GitLab instance, for recognising its links. */
export const gitlabHost = (): string => new URL(gitlabBaseUrl()).host;
