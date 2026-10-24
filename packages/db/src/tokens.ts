import { oauth } from "@claudio/forge";
import type { Db } from "./client.js";
import { decrypt } from "./crypto.js";
import { getUser, updateUserTokens } from "./queries.js";
import type { User } from "./schema.js";

/** Tokens are renewed this long before they expire. */
const MARGIN_MS = 5 * 60_000;

export const needsRefresh = (expiresAt: Date | null, now = Date.now()): boolean => expiresAt !== null && expiresAt.getTime() - now <= MARGIN_MS;

/** Renewals in progress in this process, one per user. */
const inflight = new Map<number, Promise<string | null>>();

/**
 * The user's GitHub or GitLab token, renewed first if it is about to expire
 * (GitHub OAuth Apps with expiring tokens, every GitLab token). Null when there
 * is none or it cannot be renewed; the person then has to sign in again.
 */
export async function freshAccessToken(db: Db, user: User): Promise<string | null> {
  const access = user.accessTokenEnc ? decrypt(user.accessTokenEnc) : "";
  if (!access) return null;
  if (!needsRefresh(user.tokenExpiresAt)) return access;
  if (!user.refreshTokenEnc) return null;
  let running = inflight.get(user.id);
  if (!running) {
    running = renew(db, user).finally(() => inflight.delete(user.id));
    inflight.set(user.id, running);
  }
  return running;
}

/**
 * A refresh token works once: when the web server and the worker renew at the
 * same time, only one of them succeeds. The new tokens are stored only if the row
 * still holds the refresh token this process started from; otherwise, and when
 * the provider rejects a refresh token that was used a moment ago, the token the
 * other process stored is used.
 */
async function renew(db: Db, user: User): Promise<string | null> {
  try {
    const provider = oauth(user.provider);
    if (provider.configured()) {
      const t = await provider.refresh(decrypt(user.refreshTokenEnc!));
      if (await updateUserTokens(db, user.id, t, user.refreshTokenEnc)) return t.accessToken;
    }
  } catch {
    // Expired, revoked, or just used by another process: see what the row holds now.
  }
  return renewedElsewhere(await getUser(db, user.id), user);
}

/** The access token another process stored since `before` was read, if it is still fresh. */
export function renewedElsewhere(row: Pick<User, "accessTokenEnc" | "refreshTokenEnc" | "tokenExpiresAt"> | undefined, before: Pick<User, "refreshTokenEnc">): string | null {
  if (!row || row.refreshTokenEnc === before.refreshTokenEnc || needsRefresh(row.tokenExpiresAt)) return null;
  return decrypt(row.accessTokenEnc) || null;
}
