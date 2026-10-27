import type { Provider } from "@claudio/core";
import { oauth } from "@claudio/forge";
import type { Db } from "./client.js";
import { decrypt } from "./crypto.js";
import { getIdentity, getIdentityById, updateIdentityTokens } from "./queries.js";
import type { UserIdentity } from "./schema.js";

/** Tokens are renewed this long before they expire. */
const MARGIN_MS = 5 * 60_000;

export const needsRefresh = (expiresAt: Date | null, now = Date.now()): boolean => expiresAt !== null && expiresAt.getTime() - now <= MARGIN_MS;

/** Renewals in progress in this process, one per connected account. */
const inflight = new Map<number, Promise<string | null>>();

/**
 * The token of a connected GitHub or GitLab account, renewed first if it is about
 * to expire (GitHub OAuth Apps with expiring tokens, every GitLab token). Null when
 * there is none or it cannot be renewed; the person then has to connect the account again.
 */
export async function freshAccessToken(db: Db, identity: UserIdentity): Promise<string | null> {
  const access = identity.accessTokenEnc ? decrypt(identity.accessTokenEnc) : "";
  if (!access) return null;
  if (!needsRefresh(identity.tokenExpiresAt)) return access;
  if (!identity.refreshTokenEnc) return null;
  let running = inflight.get(identity.id);
  if (!running) {
    running = renew(db, identity).finally(() => inflight.delete(identity.id));
    inflight.set(identity.id, running);
  }
  return running;
}

/**
 * A person's token for a provider. `expired` says the account is connected and
 * its token was due for renewal, but the renewal failed: the person should
 * connect the account again (unlike having no account of that provider at all).
 */
export async function tokenFor(db: Db, userId: number, provider: Provider): Promise<{ token: string | null; expired: boolean }> {
  const identity = await getIdentity(db, userId, provider);
  if (!identity) return { token: null, expired: false };
  const token = await freshAccessToken(db, identity);
  return { token, expired: !token && Boolean(identity.accessTokenEnc && identity.refreshTokenEnc) };
}

/**
 * A refresh token works once: when the web server and the worker renew at the
 * same time, only one of them succeeds. The new tokens are stored only if the row
 * still holds the refresh token this process started from; otherwise, and when
 * the provider rejects a refresh token that was used a moment ago, the token the
 * other process stored is used.
 */
async function renew(db: Db, identity: UserIdentity): Promise<string | null> {
  try {
    const provider = oauth(identity.provider);
    if (provider.configured()) {
      const t = await provider.refresh(decrypt(identity.refreshTokenEnc!));
      if (await updateIdentityTokens(db, identity.id, t, identity.refreshTokenEnc)) return t.accessToken;
    }
  } catch {
    // Expired, revoked, or just used by another process: see what the row holds now.
  }
  return renewedElsewhere(await getIdentityById(db, identity.id), identity);
}

/** The access token another process stored since `before` was read, if it is still fresh. */
export function renewedElsewhere(
  row: Pick<UserIdentity, "accessTokenEnc" | "refreshTokenEnc" | "tokenExpiresAt"> | undefined,
  before: Pick<UserIdentity, "refreshTokenEnc">,
): string | null {
  if (!row || row.refreshTokenEnc === before.refreshTokenEnc || needsRefresh(row.tokenExpiresAt)) return null;
  return decrypt(row.accessTokenEnc) || null;
}
