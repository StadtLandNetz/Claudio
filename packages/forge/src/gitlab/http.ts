import { ForgeAuthError, ForgeError, type RepoRef } from "../types.js";
import { gitlabBaseUrl } from "./config.js";

type Query = Record<string, string | number | boolean | undefined | null>;

/** A project in API paths: its id when known (survives renames), else the URL-encoded path. */
export const projectId = (repo: RepoRef): string => (repo.externalId ? String(repo.externalId) : encodeURIComponent(repo.fullName));

/**
 * The GitLab REST API (v4) with one token: a person's OAuth token or the bot's
 * personal access token, both sent as a Bearer token. `fetch` is injectable for tests.
 */
export class GitlabHttp {
  constructor(
    readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    readonly baseUrl: string = gitlabBaseUrl(),
  ) {}

  private url(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}/api/v4${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    return url.toString();
  }

  async request(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };
    let res = await this.fetcher(this.url(path, opts.query), init);
    // Rate limited: wait as long as GitLab asks (at most 10 s) and try once more.
    if (res.status === 429) {
      const wait = Math.min(10, Number(res.headers.get("retry-after")) || 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await this.fetcher(this.url(path, opts.query), init);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const data = JSON.parse(text) as { message?: unknown; error?: unknown; error_description?: unknown };
      const m = data.message ?? data.error_description ?? data.error;
      if (m) message = typeof m === "string" ? m : JSON.stringify(m);
    } catch {
      // Not JSON: keep the text.
    }
    const msg = `GitLab ${method} ${path}: ${res.status} ${message}`.trim();
    if (res.status === 401) throw new ForgeAuthError(msg);
    throw new ForgeError(msg, res.status);
  }

  async get<T>(path: string, query?: Query): Promise<T> {
    return (await this.request("GET", path, { query })).json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.request("POST", path, { body: body ?? {} });
    return (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.request("PUT", path, { body: body ?? {} });
    return (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T;
  }

  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  /** Every page of a list (100 per page), up to `max` items. */
  async paginate<T>(path: string, query: Query = {}, max = 1000): Promise<T[]> {
    const out: T[] = [];
    let page: string | null = "1";
    while (page && out.length < max) {
      const res = await this.request("GET", path, { query: { per_page: 100, ...query, page } });
      out.push(...((await res.json()) as T[]));
      page = res.headers.get("x-next-page") || null;
    }
    return out.slice(0, max);
  }
}
