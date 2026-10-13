import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteArtifactsBefore, saveArtifact, type Db } from "@claudio/db";

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/**
 * Copies a finished run's screenshots into the database: the run directory is
 * ephemeral (emptyDir in Kubernetes), the reports must keep their evidence.
 */
export async function persistArtifacts(db: Db, run: { runId: string; runDir: string }, log: (msg: string) => void): Promise<void> {
  const dir = join(run.runDir, "evidence");
  let stored = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) continue;
    const data = await readFile(join(dir, name)).catch(() => null);
    if (!data || data.length === 0) continue;
    await saveArtifact(db, { runId: run.runId, path: `evidence/${name}`, contentType: type, data })
      .then(() => stored++)
      .catch((e) => log(`could not store ${name}: ${(e as Error).message}`));
  }
  if (stored) log(`${run.runId}: ${stored} screenshot(s) stored`);
}

/** Deletes stored screenshots older than the retention period. */
export async function purgeOldArtifacts(db: Db, days: number, log: (msg: string) => void): Promise<void> {
  if (!(days > 0)) return;
  const removed = await deleteArtifactsBefore(db, new Date(Date.now() - days * 86_400_000)).catch(() => 0);
  if (removed) log(`deleted ${removed} screenshot(s) older than ${days} days`);
}
