import { refreshAccessToken } from "@claudio/github";
import type { Db } from "./client.js";
import { decrypt } from "./crypto.js";
import { updateUserTokens } from "./queries.js";
import type { User } from "./schema.js";

/**
 * The user's GitHub token, renewed first if it is about to expire (OAuth Apps
 * with expiring tokens). Null when there is none or it cannot be renewed; the
 * person then has to sign in again.
 */
export async function freshAccessToken(db: Db, user: User): Promise<string | null> {
  const access = user.accessTokenEnc ? decrypt(user.accessTokenEnc) : "";
  if (!access) return null;
  if (!user.tokenExpiresAt || user.tokenExpiresAt.getTime() - Date.now() > 5 * 60_000) return access;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!user.refreshTokenEnc || !clientId || !clientSecret) return null;
  try {
    const t = await refreshAccessToken(clientId, clientSecret, decrypt(user.refreshTokenEnc));
    await updateUserTokens(db, user.id, t);
    return t.accessToken;
  } catch {
    return null;
  }
}
