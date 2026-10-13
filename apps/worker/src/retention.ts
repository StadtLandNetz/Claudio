import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Deletes run directories (screenshots, traces, live frames) older than the
 * retention period. Reports, findings and costs stay in the database.
 */
export async function purgeOldRuns(runsRoot: string, days: number, log: (msg: string) => void): Promise<void> {
  if (!(days > 0)) return;
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  for (const name of await readdir(runsRoot).catch(() => [] as string[])) {
    if (name.startsWith(".")) continue;
    const dir = join(runsRoot, name);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory() || info.mtimeMs > cutoff) continue;
    await rm(dir, { recursive: true, force: true }).then(() => removed++).catch(() => undefined);
  }
  if (removed) log(`removed ${removed} run director${removed === 1 ? "y" : "ies"} older than ${days} days`);
}
