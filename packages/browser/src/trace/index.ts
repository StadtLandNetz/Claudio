import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { TraceIndex } from "@claudio/core";
import { parseToolCalls, parseTrace } from "./parse.js";
import { readZipDirectory, streamZipEntry, type ZipDirectory } from "./zip.js";

export * from "./parse.js";
export * from "./zip.js";

/** The index of an opened trace archive, with the agent's tool calls from log.jsonl when it exists. */
export async function indexFromZip(dir: ZipDirectory, logPath: string | null): Promise<TraceIndex> {
  const traceFile = [...dir.entries.keys()].filter((n) => n.endsWith(".trace")).sort()[0];
  const stream = traceFile ? await streamZipEntry(dir, traceFile) : null;
  if (!stream) throw new Error("no trace file in the archive");
  const base = await parseTrace(createInterface({ input: stream, crlfDelay: Infinity }));
  const toolCalls =
    logPath && existsSync(logPath) ? await parseToolCalls(createInterface({ input: createReadStream(logPath), crlfDelay: Infinity }), base.startWall) : [];
  return { ...base, toolCalls };
}

/** Opens a run's trace.zip and builds its index; null when there is no such file. */
export async function buildTraceIndex(zipPath: string, logPath: string | null): Promise<{ dir: ZipDirectory; index: TraceIndex } | null> {
  if (!existsSync(zipPath)) return null;
  const dir = await readZipDirectory(zipPath);
  return { dir, index: await indexFromZip(dir, logPath) };
}
