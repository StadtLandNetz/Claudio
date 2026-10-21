import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTraceIndex, readZipEntry, thinFrames } from "@claudio/browser/trace";
import type { TraceIndex } from "@claudio/core";
import { deleteArtifactsBefore, saveArtifact, type Db } from "@claudio/db";

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** At most this many screencast frames per run go into the database (10 to 40 KB each). */
const MAX_TRACE_FRAMES = 300;

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

/** When the run's screenshots were taken: the frames at those moments must survive the thinning. */
async function evidenceTimes(runDir: string, startWall: number): Promise<number[]> {
  const raw = await readFile(join(runDir, "evidence.json"), "utf8").catch(() => null);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as { createdAt?: unknown }[];
    return list.map((e) => Date.parse(typeof e.createdAt === "string" ? e.createdAt : "") - startWall).filter((t) => Number.isFinite(t));
  } catch {
    return [];
  }
}

/**
 * Stores a finished run's Playwright trace for the timeline: the compact index and
 * a selection of its screencast frames. Like the screenshots, they outlive the run
 * directory; the whole trace.zip stays there for download while it exists.
 */
export async function persistTrace(db: Db, run: { runId: string; runDir: string }, log: (msg: string) => void): Promise<void> {
  const built = await buildTraceIndex(join(run.runDir, "trace.zip"), join(run.runDir, "log.jsonl"));
  if (!built) return;
  const frames = thinFrames(built.index.frames, MAX_TRACE_FRAMES, await evidenceTimes(run.runDir, built.index.startWall));
  const index: TraceIndex = { ...built.index, frames };
  await saveArtifact(db, { runId: run.runId, path: "trace/index.json", contentType: "application/json", data: Buffer.from(JSON.stringify(index)) });
  let stored = 0;
  for (const f of frames) {
    const data = await readZipEntry(built.dir, `screencast/${f.file}`).catch(() => null);
    if (!data || data.length === 0) continue;
    await saveArtifact(db, { runId: run.runId, path: `trace/frames/${f.file}`, contentType: "image/jpeg", data })
      .then(() => stored++)
      .catch((e) => log(`could not store frame ${f.file}: ${(e as Error).message}`));
  }
  log(`${run.runId}: trace stored (${stored} of ${built.index.frames.length} frames)`);
}

/** Deletes stored screenshots and traces older than the retention period. */
export async function purgeOldArtifacts(db: Db, days: number, log: (msg: string) => void): Promise<void> {
  if (!(days > 0)) return;
  const removed = await deleteArtifactsBefore(db, new Date(Date.now() - days * 86_400_000)).catch(() => 0);
  if (removed) log(`deleted ${removed} stored file(s) older than ${days} days`);
}
