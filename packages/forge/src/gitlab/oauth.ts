import type { OAuthProvider, TokenSet } from "../types.js";
import { gitlabBaseUrl } from "./config.js";
import { GitlabHttp } from "./http.js";

const config = () => {
  const clientId = process.env.GITLAB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITLAB_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

function required() {
  const c = config();
  if (!c) throw new Error("GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET are not set");
  return c;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

/** GitLab's token endpoint. Its access tokens expire after two hours; each refresh token works once. */
async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const c = required();
  const res = await fetch(`${gitlabBaseUrl()}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!data.access_token) throw new Error(data.error_description ?? data.error ?? `GitLab antwortete mit ${res.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

/** The callback registered with the OAuth application; GitLab expects it again on refresh. */
const callbackUrl = () => {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/auth/gitlab/callback` : undefined;
};

/** Sign-in with a GitLab OAuth application (GITLAB_CLIENT_ID / GITLAB_CLIENT_SECRET, instance at GITLAB_URL). */
export const gitlabOAuth: OAuthProvider = {
  provider: "gitlab",
  configured: () => config() !== null,
  authorizeUrl(redirectUri, state) {
    const url = new URL(`${gitlabBaseUrl()}/oauth/authorize`);
    url.searchParams.set("client_id", required().clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    // "api": comments, commit statuses, issues and webhooks need write access; read_api is not enough.
    url.searchParams.set("scope", "api");
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchangeCode(code, redirectUri) {
    return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  },
  refresh(refreshToken) {
    const redirect = callbackUrl();
    return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token", ...(redirect ? { redirect_uri: redirect } : {}) });
  },
  async fetchUser(token) {
    const u = await new GitlabHttp(token).get<{ id: number; username: string; name?: string | null; avatar_url?: string | null }>("/user");
    return { externalId: u.id, login: u.username, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
  },
  async memberships(token) {
    const groups = await new GitlabHttp(token).paginate<{ full_path: string }>("/groups", { min_access_level: 10, all_available: false }, 2000);
    return groups.map((g) => g.full_path.toLowerCase());
  },
  grantUrl: () => (config() ? `${gitlabBaseUrl()}/-/user_settings/applications` : null),
};
