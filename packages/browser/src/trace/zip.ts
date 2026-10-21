import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw, inflateRawSync } from "node:zlib";

/**
 * A small reader for the zip files Playwright writes: entries are stored or
 * deflated, there is no zip64 and no encryption. It reads the central directory
 * once and then any entry by random access, so a 100 MB trace never has to be
 * loaded whole.
 */
export type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localHeaderOffset: number };
export type ZipDirectory = { path: string; size: number; mtimeMs: number; entries: Map<string, ZipEntry> };

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** Reads the end-of-central-directory record and the central directory. */
export async function readZipDirectory(path: string): Promise<ZipDirectory> {
  const fh = await open(path, "r");
  try {
    const { size, mtimeMs } = await fh.stat();
    // The record is 22 bytes, followed by a comment of at most 64 KiB.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip file");
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("zip64 is not supported");
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = new Map<string, ZipEntry>();
    let pos = 0;
    for (let n = 0; n < count; n++) {
      if (pos + 46 > cdSize || cd.readUInt32LE(pos) !== CENTRAL_SIG) throw new Error("malformed central directory");
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const name = cd.toString("utf8", pos + 46, pos + 46 + nameLen);
      entries.set(name, {
        name,
        method: cd.readUInt16LE(pos + 10),
        compressedSize: cd.readUInt32LE(pos + 20),
        uncompressedSize: cd.readUInt32LE(pos + 24),
        localHeaderOffset: cd.readUInt32LE(pos + 42)
      });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return { path, size, mtimeMs, entries };
  } finally {
    await fh.close();
  }
}

/**
 * Where an entry"s bytes begin. The local header repeats name and extra field with
 * its own lengths; its sizes are not trusted, because writers that stream (like
 * Playwright"s) leave them at zero and put the real sizes into the central directory.
 */
async function dataRange(dir: ZipDirectory, entry: ZipEntry): Promise<{ start: number; end: number }> {
  if (entry.method !== STORED && entry.method !== DEFLATED) throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
  const fh = await open(dir.path, "r");
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, entry.localHeaderOffset);
    if (head.readUInt32LE(0) !== LOCAL_SIG) throw new Error(`malformed local header for ${entry.name}`);
    const start = entry.localHeaderOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    return { start, end: start + entry.compressedSize };
  } finally {
    await fh.close();
  }
}

/** The whole entry, inflated. For small entries such as screencast frames. */
export async function readZipEntry(dir: ZipDirectory, name: string): Promise<Buffer | null> {
  const entry = dir.entries.get(name);
  if (!entry) return null;
  const { start, end } = await dataRange(dir, entry);
  const raw = Buffer.alloc(end - start);
  if (raw.length) {
    const fh = await open(dir.path, "r");
    try {
      await fh.read(raw, 0, raw.length, start);
    } finally {
      await fh.close();
    }
  }
  return entry.method === DEFLATED ? inflateRawSync(raw) : raw;
}

/** The entry as a stream, inflated on the fly. For the large trace file. */
export async function streamZipEntry(dir: ZipDirectory, name: string): Promise<Readable | null> {
  const entry = dir.entries.get(name);
  if (!entry) return null;
  const { start, end } = await dataRange(dir, entry);
  if (end === start) return Readable.from([]);
  const raw = createReadStream(dir.path, { start, end: end - 1 });
  if (entry.method === STORED) return raw;
  const inflate = createInflateRaw();
  raw.on("error", (e) => inflate.destroy(e));
  return raw.pipe(inflate);
}
