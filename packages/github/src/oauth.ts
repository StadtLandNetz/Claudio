/** Tokens from GitHub's OAuth endpoint. Expiry fields are set only when the OAuth App issues expiring tokens. */
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt?: Date };

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
