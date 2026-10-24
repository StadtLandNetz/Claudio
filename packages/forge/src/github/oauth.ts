import { Octokit } from "octokit";
import type { OAuthProvider, TokenSet } from "../types.js";

export type { TokenSet } from "../types.js";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error(data.error_description ?? data.error ?? `GitHub antwortete mit ${res.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<TokenSet> {
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
}

/** Renews an expiring user token (OAuth Apps with "Expire user access tokens"). */
export function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
}

const config = () => {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

function required() {
  const c = config();
  if (!c) throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not set");
  return c;
}

/** Sign-in with a GitHub OAuth App (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET). */
export const githubOAuth: OAuthProvider = {
  provider: "github",
  configured: () => config() !== null,
  authorizeUrl(redirectUri, state) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", required().clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "repo read:user read:org");
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchangeCode(code, redirectUri) {
    const c = required();
    return exchangeCode(c.clientId, c.clientSecret, code, redirectUri);
  },
  refresh(refreshToken) {
    const c = required();
    return refreshAccessToken(c.clientId, c.clientSecret, refreshToken);
  },
  async fetchUser(token) {
    const { data } = await new Octokit({ auth: token }).rest.users.getAuthenticated();
    return { externalId: data.id, login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
  },
  async memberships(token) {
    const octokit = new Octokit({ auth: token });
    const orgs = await octokit.paginate(octokit.rest.orgs.listForAuthenticatedUser, { per_page: 100 });
    return orgs.map((o) => o.login.toLowerCase());
  },
  grantUrl() {
    const c = config();
    // Organisations with OAuth access restrictions must grant Claudio access before their repos show up.
    return c ? `https://github.com/settings/connections/applications/${c.clientId}` : null;
  },
};
