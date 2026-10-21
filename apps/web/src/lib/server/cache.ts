/**
 * A small in-memory cache for slow lookups (GitHub) with stale-while-revalidate:
 * a value younger than `freshMs` is returned as is; one younger than `staleMs`
 * is returned at once and renewed in the background; older ones are renewed
 * first. Errors are never cached. One process, one cache: fine for one web pod.
 */
type Entry = { value: unknown; at: number; renewing: Promise<unknown> | null };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 1000;

export async function swr<T>(key: string, freshMs: number, staleMs: number, load: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = store.get(key);
	const renew = (): Promise<T> => {
		if (hit?.renewing) return hit.renewing as Promise<T>;
		const p = load()
			.then((value) => {
				store.delete(key);
				store.set(key, { value, at: Date.now(), renewing: null });
				if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
				return value;
			})
			.finally(() => {
				const e = store.get(key);
				if (e && e.renewing === p) e.renewing = null;
			});
		if (hit) hit.renewing = p;
		return p;
	};
	if (hit && now - hit.at < freshMs) return hit.value as T;
	if (hit && now - hit.at < staleMs) {
		renew().catch(() => undefined);
		return hit.value as T;
	}
	return renew();
}

/** Drops cached values whose key starts with `prefix`, e.g. after a change the next read must see. */
export function forget(prefix: string): void {
	for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
