import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZipDirectory, readZipEntry, streamZipEntry } from '../src/lib/server/zip.js';

type Spec = { name: string; data: Buffer; method: 0 | 8 };

/** Writes entries the way a streaming writer (yazl, Playwright) does: sizes only in the central directory. */
function makeZip(specs: Spec[], opts: { zip64?: boolean } = {}): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const s of specs) {
		const name = Buffer.from(s.name, 'utf8');
		const data = s.method === 8 ? deflateRawSync(s.data) : s.data;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0808, 6); // bit 3: sizes follow the data (left at zero here)
		local.writeUInt16LE(s.method, 8);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(2, 28); // a two-byte extra field, to prove it is skipped
		const extra = Buffer.from([0xaa, 0xbb]);
		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0);
		cen.writeUInt16LE(s.method, 10);
		cen.writeUInt32LE(crc32(s.data), 16);
		cen.writeUInt32LE(data.length, 20);
		cen.writeUInt32LE(s.data.length, 24);
		cen.writeUInt16LE(name.length, 28);
		cen.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cen, name]));
		const entry = Buffer.concat([local, name, extra, data]);
		parts.push(entry);
		offset += entry.length;
	}
	const cd = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(opts.zip64 ? 0xffff : specs.length, 8);
	eocd.writeUInt16LE(opts.zip64 ? 0xffff : specs.length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, cd, eocd]);
}

async function tmpZip(buf: Buffer): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'claudio-zip-'));
	const path = join(dir, 'trace.zip');
	await writeFile(path, buf);
	return path;
}

const text = (lines: string[]) => Buffer.from(lines.join('\n'), 'utf8');

describe('zip reader', () => {
	const specs: Spec[] = [
		{ name: 'trace.trace', data: text(['{"type":"context-options"}', '{"type":"after"}', '']), method: 8 },
		{ name: 'screencast/page@1-2.jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), method: 0 },
		{ name: 'empty.dat', data: Buffer.alloc(0), method: 8 }
	];

	it('lists the central directory', async () => {
		const dir = await readZipDirectory(await tmpZip(makeZip(specs)));
		expect([...dir.entries.keys()]).toEqual(['trace.trace', 'screencast/page@1-2.jpeg', 'empty.dat']);
		expect(dir.entries.get('trace.trace')?.uncompressedSize).toBe(specs[0]!.data.length);
	});

	it('reads stored and deflated entries', async () => {
		const dir = await readZipDirectory(await tmpZip(makeZip(specs)));
		expect(await readZipEntry(dir, 'screencast/page@1-2.jpeg')).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		expect((await readZipEntry(dir, 'trace.trace'))?.toString()).toBe(specs[0]!.data.toString());
		expect(await readZipEntry(dir, 'empty.dat')).toEqual(Buffer.alloc(0));
		expect(await readZipEntry(dir, 'missing')).toBeNull();
	});

	it('streams an entry line by line', async () => {
		const dir = await readZipDirectory(await tmpZip(makeZip(specs)));
		const stream = await streamZipEntry(dir, 'trace.trace');
		const lines: string[] = [];
		for await (const line of createInterface({ input: stream!, crlfDelay: Infinity })) lines.push(line);
		expect(lines).toEqual(['{"type":"context-options"}', '{"type":"after"}']);
		expect(await streamZipEntry(dir, 'missing')).toBeNull();
	});

	it('rejects zip64 and non-zip files', async () => {
		await expect(readZipDirectory(await tmpZip(makeZip(specs, { zip64: true })))).rejects.toThrow(/zip64/);
		await expect(readZipDirectory(await tmpZip(Buffer.from('not a zip at all, really not')))).rejects.toThrow(/not a zip/);
	});

	const real = resolve(import.meta.dirname, '../../../runs/test-4-20261016-005200-l99n/trace.zip');
	it.skipIf(!existsSync(real))('opens a real Playwright trace', async () => {
		const dir = await readZipDirectory(real);
		expect(dir.entries.has('trace.trace')).toBe(true);
		const stream = await streamZipEntry(dir, 'trace.trace');
		const first = await new Promise<string>((done) => {
			const rl = createInterface({ input: stream! });
			rl.once('line', (l) => {
				done(l);
				rl.close();
				stream!.destroy();
			});
		});
		expect(JSON.parse(first).type).toBe('context-options');
	});
});
